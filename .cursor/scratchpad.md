# Scratchpad

## Background and Motivation

NestJS + TypeORM backend (`core-backend`). New planning task: **add admin endpoint(s) to change player roles**.

Existing admin surface (`src/admin/admin.controller.ts`):

- `POST /admin/discord/sync` — re-sync Discord roles/voice channels for verified teams.
- `POST /admin/players/:playerId/verify` — set player's primary role to «Гравець», stamp `verifiedAt`, add Discord verified role.
- `DELETE /admin/players/:playerId/verify` — revert primary role to «Гість», clear `verifiedAt`, remove Discord verified role.

Role catalog (`src/user-roles/role.constants.ts`): `Гість`, `Гравець`, `Капітан`, `Медіа`, `Адмін` (`isAdminRole=true` only for `Адмін`). Each player typically has one non-admin "primary" role row plus an optional admin row. `verifyPlayer`/`unverifyPlayer` enforce the single-primary-role invariant.

Gap: there is no admin endpoint to set a player to «Капітан» or «Медіа», or to grant/revoke «Адмін». Captain assignment is currently a side effect of team management; media + admin promotions cannot be done via API.

## Key Challenges and Analysis

1. **Side-effect parity with verify/unverify.** Setting `Гравець` should match `verifyPlayer` (stamp `verifiedAt`, Discord verified ON); setting `Гість` should match `unverifyPlayer` (clear `verifiedAt`, Discord verified OFF). Other roles (`Капітан`, `Медіа`) should leave `verifiedAt` untouched (a captain is implicitly verified; media is editorial). No Discord wiring exists for `Медіа` or `Адмін`, so no Discord call for those.
2. **Admin role is additive, not exclusive.** Granting `Адмін` should add an `isAdminRole=true` row alongside the existing primary role, not replace it. Revoking should remove only admin rows. Mixing this into a single "set role" endpoint overloads semantics, so a separate grant/revoke pair (mirroring the existing `verify`/`unverify` POST/DELETE pattern) keeps things clean.
3. **Captain interaction with `TeamsService`.** `TeamsService` already creates/maintains a `Капітан` row when a player is set as a team captain, and Discord captain role is managed by team flows. The admin endpoint should *not* duplicate Discord captain wiring (avoid drift); it should only update the user_roles row. Worth flagging in the response/docs that this does not change team captaincy.
4. **Single non-admin role invariant.** Reuse the same dedupe pattern as `verifyPlayer` (`nonAdminRoles.slice(1)` removal) so the data model stays consistent.
5. **Authorization.** Reuse `JwtAuthGuard` + `AdminGuard` (already applied at controller level).
6. **Validation.** Body must restrict `name` to the four assignable primary roles (exclude `Адмін`, since admin has its own dedicated grant/revoke endpoints).
7. **Self-protection (optional, recommended).** Prevent an admin from revoking their own admin role to avoid lockout. Easy to enforce by comparing `req.user.playerId` with `:playerId`.

## High-level Task Breakdown

Tasks are intentionally small and verifiable. Executor completes one at a time and waits for verification before proceeding.

- [ ] **Task 1 — Add DTO `SetPlayerRoleDto`.**
  - File: `src/admin/dto/set-player-role.dto.ts` (new).
  - Single field `name: RoleName` validated with `@IsIn([Role.GUEST, Role.PLAYER, Role.MEDIA])` (deliberately excludes `Адмін` — has its own grant/revoke routes — and `Капітан` — managed by `TeamsService`). `@ApiProperty({ enum: [...] })` for Swagger.
  - **Success:** File compiles; validation rejects `Адмін`, `Капітан`, and arbitrary strings; Swagger schema lists exactly three options.

- [ ] **Task 2 — Extract role-mutation helper in `AdminService`.**
  - Refactor `verifyPlayer`/`unverifyPlayer` to call a new private helper `setPrimaryRole(playerId, name: RoleName): Promise<PlayerRoleResult>`.
  - Helper:
    - Loads player with roles (existing `findPlayerWithRoles`).
    - Removes duplicate non-admin rows (`slice(1)`).
    - Renames or creates the single primary row to `name`.
    - Updates `verifiedAt`: `Гравець` → `now`; `Гість` → `null`; otherwise leave unchanged.
    - Calls `discord.setVerifiedRole(player.discordId, true|false)` only for `Гравець`/`Гість`.
    - Returns `{ playerId, name, verifiedAt }`.
  - `verifyPlayer` and `unverifyPlayer` keep their existing return type `VerifyResult`; they internally call the helper and translate (or stay as-is and we simply share the body via a private util — choose whichever yields the smallest diff).
  - **Success:** Existing verify/unverify behavior unchanged (same DB writes, same Discord calls, same response shape). Build green.

- [ ] **Task 3 — Add `setPlayerRole` service method.**
  - Public wrapper: `setPlayerRole(playerId, name): Promise<PlayerRoleResult>` that calls `setPrimaryRole`.
  - **Success:** Method compiles; returns `PlayerRoleResult`.

- [ ] **Task 4 — Add controller route `PUT /admin/players/:playerId/role`.**
  - In `src/admin/admin.controller.ts`:
    ```ts
    @Put('players/:playerId/role')
    @ApiOperation({ summary: "Set player's primary role (Гість/Гравець/Медіа)" })
    setPlayerRole(
      @Param('playerId', ParseUUIDPipe) playerId: string,
      @Body() body: SetPlayerRoleDto,
    ): Promise<PlayerRoleResult> {
      return this.adminService.setPlayerRole(playerId, body.name);
    }
    ```
  - Add `Put`, `Body` to `@nestjs/common` imports.
  - **Success:** Swagger lists the new endpoint with the correct three-value enum body; happy-path call to set `Медіа` writes a single non-admin row named `Медіа` and leaves `verifiedAt` untouched.

- [ ] **Task 5 — Add admin grant/revoke service + routes.**
  - Service:
    - `grantAdmin(playerId): Promise<{ playerId; isAdmin: true }>` — idempotently ensures an `isAdminRole=true` row exists (do not duplicate; if a row already exists, return as-is).
    - `revokeAdmin(playerId, actorPlayerId): Promise<{ playerId; isAdmin: false }>` — removes all `isAdminRole=true` rows; throws `ForbiddenException('Cannot revoke your own admin role')` if `playerId === actorPlayerId`.
  - Controller:
    - `POST /admin/players/:playerId/admin` → `grantAdmin`.
    - `DELETE /admin/players/:playerId/admin` → `revokeAdmin` (passes `req.user.playerId`).
  - Add `Req` and the same authed `Request` typing as in `user-roles.controller.ts`.
  - **Success:** Granting twice is a no-op; revoking removes admin row(s); self-revoke returns 403; non-admin response code 403 from `AdminGuard` is unaffected.

- [ ] **Task 6 — Manual smoke test via Swagger / curl.**
  - As an admin, set a test player's role to `Медіа`, then `Капітан`, then back to `Гравець`; verify DB and that `verifiedAt` updates only on `Гравець`/`Гість`.
  - Grant admin to a non-admin user, confirm both rows exist, then revoke.
  - Try self-revoke: expect 403.
  - **Success:** Behaviors match expectations end-to-end.

- [ ] **Task 7 — Lint + build.**
  - `npm run lint` and `npm run build` both clean.
  - **Success:** No new errors.

## Decisions (locked in)

1. **Endpoint shape:** Option A — `PUT /admin/players/:playerId/role` + `POST`/`DELETE /admin/players/:playerId/admin`.
2. **`Капітан` excluded** from primary-role assignment (managed by `TeamsService`); DTO accepts only `Гість`, `Гравець`, `Медіа`.
3. **Self-revoke admin guard:** kept (403 if `req.user.playerId === :playerId`).
4. **Discord side-effects (default):** only `Гравець`↔`Гість` toggle Discord verified; `Медіа`/`Адмін` make no Discord calls; captain wiring stays in `TeamsService`.
5. **Response shape (default):** new `PlayerRoleResult { playerId, name, verifiedAt }` for the new endpoint; existing `verify`/`unverify` continue to return `VerifyResult` (no breaking change).

## Project Status Board

- [x] Planner: gathered context (controller, service, role catalog, Discord service, teams interaction)
- [x] Planner: user approved Option A; Captain excluded; self-revoke guard kept; defaults locked for Discord side-effects and response shape
- [x] Executor: Task 1 — `SetPlayerRoleDto`
- [x] Executor: Task 2 — extract `setPrimaryRole` helper
- [x] Executor: Task 3 — `setPlayerRole` service method
- [x] Executor: Task 4 — `PUT /admin/players/:playerId/role` route
- [x] Executor: Task 5 — admin grant/revoke service + routes
- [ ] Executor: Task 6 — manual smoke test (deferred to user)
- [x] Executor: Task 7 — lint + build clean

## Current Status / Progress Tracking

- **Mode:** Executor. All code tasks complete. `npm run lint` and `npm run build` both green. Awaiting user smoke test (Task 6).

## Executor's Feedback or Assistance Requests

- Implementation complete. New endpoints under `/admin` (all guarded by `JwtAuthGuard + AdminGuard`):
  - `PUT  /admin/players/:playerId/role` — body `{ name: 'Гість'|'Гравець'|'Медіа' }` → returns `PlayerRoleResult`.
  - `POST /admin/players/:playerId/admin` → returns `AdminRoleResult { isAdmin: true }`. Idempotent.
  - `DELETE /admin/players/:playerId/admin` → returns `AdminRoleResult { isAdmin: false }`. Returns 403 on self-revoke.
- `verifyPlayer` / `unverifyPlayer` now share a private `setPrimaryRole` helper; behavior + response shape unchanged.
- Captain is intentionally NOT in the `SetPlayerRoleDto` enum (managed by `TeamsService`).
- Build hit one TS1272 (decorated signature requires `import type` for `RoleName`); resolved by splitting the import.

## Lessons

- After adding a `Role` enum value, keep `ROLE_NAMES`, `ROLE_CATALOG_IDS`, `ROLE_CATALOG_DISPLAY_ORDER`, and `ROLE_COLOR_HEX` in sync or `Record<RoleName, string>` fails the build.
- Catalog listing should query `playerId IS NULL` via QueryBuilder; `find` + `relations: ['player']` can interact badly with nullable `ManyToOne` in some cases.
- `verifyPlayer`/`unverifyPlayer` enforce a single-non-admin-role invariant by deduping `nonAdminRoles.slice(1)`. Any new role-mutation flow should follow the same pattern.
- Discord wiring exists only for `verified` (per-player) and `Капітан` (per-team-captain via `TeamsService`); there is no Discord role wired for `Медіа` or `Адмін`.
- TS1272 with `isolatedModules + emitDecoratorMetadata`: type aliases used in decorated DTO field signatures (e.g. `name: RoleName` under `@IsIn(...)`) must be imported via `import type` (or via a namespace import). Mixed `import { Role, RoleName }` will fail the build even when the type is used purely as a type annotation.
