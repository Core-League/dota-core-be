# Plan: Dota2 League Admin Sync for Team Captains

> Source: User request — keep a verified team's captain in sync with the Dota2 league admin list. Assign league admin when a team is verified (and to the new captain when captaincy changes); revoke it when the team loses verification, the captain loses player-verification, the team disbands, or the captain is deleted. Endpoints `post_addadmin` / `post_revokeadmin` are already wrapped by `Dota2Service.addLeagueAdmin` / `revokeLeagueAdmin` (steamId→accountId conversion inlined).

## Context — what already works (do not rebuild)

The v1 app already implements the bulk of this. Audit confirmed correct, leave as-is unless a phase says otherwise:

- **Verify team (v1):** `TeamsService.onTeamVerified` (`teams.service.ts:177`) → `addLeagueAdmin(captain.steamId)` when `captain.steamId && captain.verifiedAt`.
- **Change captain:** `TeamsService.changeCaptain:297` → revoke old captain, add new captain (when `team.isVerified`).
- **Captain leaves → next promoted:** `TeamsService.removePlayerFromTeam:437` → revoke old, add promoted (when `team.isVerified`).
- **Admin un-verifies team:** `AdminService.unverifyTeam:335` → revoke captain.
- **Admin un-verifies captain (player):** `AdminService.unverifyPlayer:233` → revoke. **Verifies player who captains a verified team:** `verifyPlayer:217` → add.

## Frontend reality (verified against CoreFrontend)

The whole verification lifecycle runs on the **v2** client (`apiClientV2` → `/verification/slots|requests|requests/:id/process|complete|cancel`). A team becomes verified **only** through v2 `POST /verification/requests/:id/complete`. The v1 admin endpoints the FE still calls are revoke/verify-player only: `DELETE /admin/teams/:id/verify` (`unverifyTeam`) and `POST|DELETE /admin/players/:id/verify`.

**Consequence:** v1's `onTeamVerified` add-path is effectively dead for verification — it is reachable only via a generic team `PATCH` or manual admin edit, which the FE does not drive. So today **no captain receives Dota2 league admin on a real verification.** Phase 1 is therefore the entire add-trigger for the live flow, not a corner case.

## The gaps this plan closes

1. **v2 verification flow assigns no Dota2 admin.** `VerificationRequestService.complete` → `teamRepo.markVerified` (raw SQL `UPDATE`) bypasses v1's `onTeamVerified`; the v2 `VerificationModule` doesn't even import `Dota2Service`. This is the primary gap — and per the FE check above, the *only* live add-path.
2. **Team disband doesn't revoke.** `TeamsService.remove` (called when a verified team's last captain leaves) deletes the Discord role/channel but never calls `revokeLeagueAdmin`.
3. **Player hard-delete doesn't revoke / reassign.** `PlayersService.remove:92` deletes a player row with no captaincy reassignment and no Dota2 revoke — a deleted captain leaves a lingering league admin and a captain-less team.
4. **Generic team update path doesn't revoke.** `TeamsService.update:122` runs `onTeamVerified` on the verify transition but has no inverse for verified→unverified via a plain `PATCH`. (Note: `reassignCaptainIfPlayerIsCaptain:543` is dead — zero callers — folded into Phase 3.)

## Architectural decisions

Durable decisions that apply across all phases:

- **The rule (matches v1):** a captain holds Dota2 league admin **iff** `team.isVerified === true` AND `captain.steamId != null` AND `captain.verifiedAt != null`. Every add is guarded by all three; every revoke fires on any transition that breaks the conjunction.
- **Idempotency / fire-and-forget:** Dota2 calls stay `void`-dispatched and swallow their own errors (existing `addLeagueAdmin`/`revokeLeagueAdmin` log-and-continue). League sync must never fail the surrounding business transaction.
- **Read captain state *after* the DB transaction commits**, not before — a FIRST verification stamps the captain's `verifiedAt` in the same transaction, so the add-guard must observe the post-commit row.
- **v2 reaches Dota2 directly:** extend `TeamRepository` (v2) to expose the captain's `steamId` + `verifiedAt`, import `Dota2Service` into the v2 verification module, and call it from `VerificationRequestService`. No cross-calling into v1 `TeamsService`.
- **No schema changes.** All needed columns (`team.isVerified/verifiedAt/captainId`, `player.steamId/verifiedAt`) already exist.

---

## Phase 1: v2 verification completion assigns league admin

**Scope**: When a team is verified through the v2 booking flow, its captain is added to the Dota2 league admin list.

### What to build

After `VerificationRequestService.complete` marks a FIRST verification done and commits, resolve the team's captain's `steamId` + `verifiedAt` and, when the rule holds (`isVerified && steamId && verifiedAt`), fire `Dota2Service.addLeagueAdmin(steamId)`. `Dota2Service` is wired into the v2 verification module; `TeamRepository` gains a captain-state lookup. The call is post-commit, fire-and-forget, and never blocks or fails the completion response.

### Acceptance criteria

- [ ] Completing a FIRST verification for a team whose captain has a linked Steam account triggers exactly one `post_addadmin` for that captain.
- [ ] No add fires for an `MmrUpdate` request (team already verified) or when the captain lacks `steamId`/`verifiedAt`.
- [ ] If the captain was unverified before this request and is verified *within* it, the add still fires (state read post-commit).
- [ ] A Dota2 HTTP failure logs and does not fail the `complete` request.
- [ ] `Dota2Service` is provided/exported correctly for the v2 module; app boots on both entry points.

---

## Phase 2: Revoke league admin on team disband

**Scope**: Disbanding a verified team removes its captain from the Dota2 league admin list.

### What to build

In `TeamsService.remove`, when the team being disbanded is verified and its captain has a `steamId`, fire `revokeLeagueAdmin(captain.steamId)` alongside the existing Discord role/channel cleanup. This covers both direct disband and the last-captain-leaves path (`removePlayerFromTeam` → `remove`).

### Acceptance criteria

- [ ] Disbanding a verified team fires one `post_revokeadmin` for the captain.
- [ ] Disbanding an unverified team fires no Dota2 call.
- [ ] Last-captain-leaves (no main player to promote → disband) revokes the leaving captain.
- [ ] Revoke is fire-and-forget; a failure does not block disband.

---

## Phase 3: Revoke + reassign on captain player deletion

**Scope**: Hard-deleting a player who captains a verified team reassigns captaincy (or disbands) and revokes their league admin, instead of orphaning the team.

### What to build

Before `PlayersService.remove` deletes the row, route a captain through the same reassignment logic captain-leave uses: promote the next main player (revoke old captain's admin, add new captain's admin when the team is verified), or disband if no one can be promoted (Phase 2 handles the revoke). Consolidate onto the live reassignment path and delete the unused `reassignCaptainIfPlayerIsCaptain` (or wire it in as the single shared implementation — pick one, no duplicate logic).

### Acceptance criteria

- [ ] Deleting a captain of a verified multi-player team promotes the next main player, revokes the deleted captain's admin, and adds the new captain's admin (when eligible).
- [ ] Deleting the sole captain disbands the team and revokes admin.
- [ ] Deleting a non-captain player fires no Dota2 call and changes no captaincy.
- [ ] No team is left with a `null`/deleted captain after a delete.
- [ ] Exactly one implementation of the reassign-on-leave logic remains.

---

## Phase 4: Audit fixes — generic update unverify + cooldown no-op

**Scope**: Close the remaining revoke gap on the generic team-update path and document the v2 cancel path as a deliberate no-op.

### What to build

Mirror `onTeamVerified` with an inverse in `TeamsService.update`: when a plain `PATCH` flips `isVerified` from true→false, revoke the captain's league admin (same guard as `unverifyTeam`). Confirm and leave the v2 admin-cancel/cooldown path untouched — cancelling a *processing* request sets a re-verification cooldown but does not un-verify an already-verified team, so no revoke is owed; add a short code comment stating this so it isn't mistaken for a gap later.

### Acceptance criteria

- [ ] `PATCH`-ing a verified team to `isVerified:false` revokes the captain (parity with `unverifyTeam`).
- [ ] Toggling unrelated team fields fires no Dota2 call.
- [ ] v2 `cancel` of a processing request still only sets the cooldown — no unverify, no revoke — with a comment explaining why.
- [ ] No double-revoke when both `update` and `unverifyTeam` could apply (one source of truth or guarded).
