# Verification voice-access role — design

**Date:** 2026-07-13
**Status:** Approved
**Area:** v2 (`src/use-cases/verification`, `src/connectors`, `src/repos`)

## Problem

During verification, players spam and chaotically join the verification voice
channels. We want the closed verification voice section to be reachable **only**
by teams whose verification is actively being processed, with access granted and
revoked automatically by the bot — no manual role juggling.

## Behaviour

A captain books a 30-min verification slot on the site (existing v2
`verification_request` / `verification_slot` flow). The Discord voice access is
tied to the **processing** state of that request:

```
book (pending) ──POST /verification/requests/:id/process──▶ GRANT role
                                                            │
                            ┌───────────────────────────────┴───────────────┐
                    POST .../complete                                POST .../cancel
                            │                                        (only from processing)
                            ▼                                                ▼
                       REVOKE role                                      REVOKE role
```

- **Grant** happens when the admin takes the request into processing (`process()`).
- **Revoke** happens on `complete()` (any) and on `cancel()` **only when the
  request was in `processing`** (a `pending` cancel never granted the role, so
  nothing to revoke).
- Recipients: the captain (`verification_request.createdByPlayerId`) **and** every
  player in `verification_request_player`, restricted to those with a linked
  `player.discordId`. Players without a linked Discord are silently skipped.
- No slot-end / timer-based revoke (explicit product decision). The role lifetime
  equals the processing window, closed by the admin's complete/cancel action.

The backend only toggles **role membership**. Which voice channels the role can
see/connect to is configured once, by hand, on the Discord server (role
permissions on the private verification voice category). That is not the
backend's job.

**Discord role id:** `1526337913854496922`.

## Architecture

Everything lives in v2, where the verification domain already lives. No new DB
tables, no migration, no cron — the whole lifecycle is driven by the three
existing admin-triggered service methods.

### 1. Discord connector — `src/connectors/discord/` (new)

Mirrors `src/dota2/` (the nearest sibling, already injected into
`VerificationRequestService`): raw `@nestjs/axios` `HttpModule` + `HttpService`,
Discord REST API v10, bot auth header.

- `discord-connector.module.ts` — `@Module` importing
  `HttpModule.register({ timeout, maxRedirects })`, provides+exports
  `DiscordConnectorService`.
- `discord-connector.service.ts` — `DiscordConnectorService`:
  - `addMemberRole(discordId: string, roleId: string): Promise<void>` — `PUT
    /guilds/{guild}/members/{discordId}/roles/{roleId}`, header
    `Authorization: Bot ${token}`, single retry on HTTP 429 honouring
    `retry_after`.
  - `removeMemberRole(discordId: string, roleId: string): Promise<void>` —
    `DELETE` on the same URL.
  - `grantRole(discordIds: string[], roleId: string): Promise<void>` /
    `revokeRole(discordIds: string[], roleId: string): Promise<void>` — bulk
    helpers, skip null/empty ids.
  - `ready(): boolean` — true only when `DISCORD_BOT_TOKEN` and
    `DISCORD_SYNC_GUILD_ID` are set; every method no-ops otherwise (same guard as
    v1 `DiscordBotService`).
  - Token/guild read from `process.env.DISCORD_BOT_TOKEN` /
    `process.env.DISCORD_SYNC_GUILD_ID` (same style as `Dota2Service` and v1
    `DiscordBotService`).
  - **Errors are swallowed** (logged, not thrown), so callers can fire-and-forget
    exactly like `dota2.addLeagueAdmin`.

### 2. `PlayerRepository.findDiscordIdsByIds(ids: string[])` (new)

Raw SQL mirroring the existing `findByIds`:
`SELECT "id", "discordId" FROM "player" WHERE "id" = ANY($1)`, returns
`Array<{ id: string; discordId: string | null }>`. This is the single place v2
reads `discordId` — no `PlayerModel`/mapper changes needed.

### 3. `VerificationRequestService` wiring

`src/use-cases/verification/verification-request.service.ts` — replaces the
existing `// TODO: notify the captain + players` hooks:

- Inject `DiscordConnectorService` (constructor); add `DiscordConnectorModule` to
  `verification.module.ts` `imports`.
- Private helper `collectVerificationDiscordIds(request)`:
  - `ids = new Set([request.createdByPlayerId, ...request.players.map(p => p.playerId)])`
  - `rows = await this.playerRepo.findDiscordIdsByIds([...ids])`
  - return `rows.map(r => r.discordId).filter(Boolean)` (deduped, non-null).
- `process(id)`: after `setStatus(Processing)`, fire-and-forget
  `void this.discord.grantRole(ids, VERIFICATION_VOICE_ROLE_ID)`.
- `complete(id, input)`: post-commit (after the existing transaction, alongside
  the `dota2.addLeagueAdmin` call), fire-and-forget
  `void this.discord.revokeRole(ids, VERIFICATION_VOICE_ROLE_ID)`.
- `cancel(id)`: in the **processing** branch only, fire-and-forget
  `void this.discord.revokeRole(ids, VERIFICATION_VOICE_ROLE_ID)`.

### 4. Constant

`src/use-cases/verification/verification.constants.ts`:
`export const VERIFICATION_VOICE_ROLE_ID = '1526337913854496922';`
(Kept as a code constant, matching v1's hardcoded role-id constants such as
`CAPTAIN_ROLE_ID`.)

## Out of band (manual)

- **Discord:** grant role `1526337913854496922` View Channel + Connect on the
  private verification voice category (one-time, admin in Discord UI).
- **Deploy:** nothing to do. `DISCORD_BOT_TOKEN` + `DISCORD_SYNC_GUILD_ID` are
  already set inline in `.github/workflows/deploy.yml` and forwarded to `api-v2`
  via the shared `&common` `environment:` anchor in `docker-compose.yml` (both
  `api-v1` and `api-v2` use `<<: *common`). v2 reads them from `process.env` at
  runtime — no new secret, no compose/workflow edit.

## Error handling

- All Discord calls are fire-and-forget with swallowed errors; a Discord outage
  or a member who left the guild never fails the HTTP request or the DB
  transaction.
- Discord role add/remove are idempotent, so re-deriving the id set on revoke and
  re-issuing calls is safe.

## Known limitations (accepted)

- If a player is simultaneously in two `processing` requests, completing one
  removes a role the other still needs. Rare; accepted.
- No safety-net timer for a request stuck in `processing` (product decision — no
  slot-end revoke). A guard sweeper can be added later if it proves necessary.

## Testing

Per repo policy, automated tests are written only on request. Verification is a
manual smoke test against a Discord test guild: process → role appears on
captain + players → complete/cancel → role removed.

## Files

New:
- `src/connectors/discord/discord-connector.module.ts`
- `src/connectors/discord/discord-connector.service.ts`

Changed:
- `src/repos/player.repository.ts` — add `findDiscordIdsByIds`
- `src/use-cases/verification/verification-request.service.ts` — grant/revoke wiring
- `src/use-cases/verification/verification.module.ts` — import Discord module
- `src/use-cases/verification/verification.constants.ts` — role-id constant

No deployment/config files change — the two Discord env vars are already
forwarded to `api-v2`.
