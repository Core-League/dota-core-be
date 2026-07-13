# Verification Voice-Access Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically grant a Discord role that unlocks the private verification voice channels when an admin takes a verification request into processing, and remove it when the request is completed or cancelled.

**Architecture:** All work is in the v2 app, where the verification domain lives. A new low-level v2 Discord connector (mirroring `Dota2Module`) toggles a guild member's role via the Discord REST API. `VerificationRequestService.process/complete/cancel` fire-and-forget grant/revoke calls, resolving Discord IDs for the captain + request players through a new `PlayerRepository` method. No DB schema, migration, or cron — the role's lifetime equals the request's `processing` window, closed by explicit admin actions.

**Tech Stack:** NestJS 11, TypeORM 0.3 (raw SQL for the v1-owned `player` table), `@nestjs/axios` (`HttpService`) + RxJS `firstValueFrom`, Discord REST API v10.

## Global Constraints

- Discord role id (constant, in code): `VERIFICATION_VOICE_ROLE_ID = '1526337913854496922'`.
- All Discord calls are **fire-and-forget** (`void ...`) with **swallowed errors** (log, never throw), matching `Dota2Service.addLeagueAdmin` — a Discord failure must never fail the HTTP response or the DB transaction.
- The connector reads `process.env.DISCORD_SYNC_GUILD_ID` / `process.env.DISCORD_BOT_TOKEN` (already forwarded to `api-v2`); every method no-ops when either is unset (`ready()` guard).
- Tests are written only on request (repo policy). Verification gate per task is `npm run lint` + `npm run build`; feature-level verification is a manual Discord smoke test (final section).
- Follow existing v2 patterns; do not pull the v1 `DiscordBotModule` into v2 (it carries unrelated team/channel logic).

---

### Task 1: v2 Discord connector

**Files:**
- Create: `src/connectors/discord/discord-connector.service.ts`
- Create: `src/connectors/discord/discord-connector.module.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `DiscordConnectorService.grantRole(discordIds: string[], roleId: string): Promise<void>`
  - `DiscordConnectorService.revokeRole(discordIds: string[], roleId: string): Promise<void>`
  - `DiscordConnectorService.addMemberRole(discordId: string, roleId: string): Promise<void>`
  - `DiscordConnectorService.removeMemberRole(discordId: string, roleId: string): Promise<void>`
  - `DiscordConnectorModule` (exports `DiscordConnectorService`)

- [ ] **Step 1: Create the connector service**

Create `src/connectors/discord/discord-connector.service.ts`:

```ts
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

/**
 * Minimal v2 Discord REST client: toggles a guild member's roles. Mirrors the
 * v1 DiscordBotService member-role helpers but carries none of its team/channel
 * logic. Every method no-ops when the bot is unconfigured and swallows its own
 * errors (logs only), so callers can fire-and-forget without a Discord outage
 * failing their request — same contract as Dota2Service.addLeagueAdmin.
 */
@Injectable()
export class DiscordConnectorService {
  private readonly logger = new Logger(DiscordConnectorService.name);

  constructor(private readonly http: HttpService) {}

  private get guildId(): string | undefined {
    return process.env.DISCORD_SYNC_GUILD_ID?.trim();
  }

  private get token(): string | undefined {
    return process.env.DISCORD_BOT_TOKEN?.trim();
  }

  private get headers() {
    return { Authorization: `Bot ${this.token}` };
  }

  private ready(): boolean {
    return !!(this.token && this.guildId);
  }

  /** Adds `roleId` to each Discord user, skipping empties. */
  async grantRole(discordIds: string[], roleId: string): Promise<void> {
    for (const id of discordIds) {
      await this.addMemberRole(id, roleId);
    }
  }

  /** Removes `roleId` from each Discord user, skipping empties. */
  async revokeRole(discordIds: string[], roleId: string): Promise<void> {
    for (const id of discordIds) {
      await this.removeMemberRole(id, roleId);
    }
  }

  async addMemberRole(discordId: string, roleId: string): Promise<void> {
    if (!this.ready() || !discordId) return;
    const url = `https://discord.com/api/v10/guilds/${this.guildId}/members/${discordId}/roles/${roleId}`;
    await this.putWithRetry(
      url,
      `addMemberRole discordId=${discordId} roleId=${roleId}`,
    );
  }

  async removeMemberRole(discordId: string, roleId: string): Promise<void> {
    if (!this.ready() || !discordId) return;
    const url = `https://discord.com/api/v10/guilds/${this.guildId}/members/${discordId}/roles/${roleId}`;
    await this.deleteWithRetry(
      url,
      `removeMemberRole discordId=${discordId} roleId=${roleId}`,
    );
  }

  private async putWithRetry(url: string, label: string): Promise<void> {
    try {
      await firstValueFrom(this.http.put(url, null, { headers: this.headers }));
    } catch (e) {
      const retryMs = this.retryAfterMs(e);
      if (retryMs !== null) {
        this.logger.warn(`${label} rate limited, retrying in ${retryMs}ms`);
        await new Promise((r) => setTimeout(r, retryMs));
        try {
          await firstValueFrom(
            this.http.put(url, null, { headers: this.headers }),
          );
        } catch (e2) {
          this.logger.warn(`${label} retry failed: ${this.errMsg(e2)}`);
        }
      } else {
        this.logger.warn(`${label} failed: ${this.errMsg(e)}`);
      }
    }
  }

  private async deleteWithRetry(url: string, label: string): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(url, { headers: this.headers }));
    } catch (e) {
      const retryMs = this.retryAfterMs(e);
      if (retryMs !== null) {
        this.logger.warn(`${label} rate limited, retrying in ${retryMs}ms`);
        await new Promise((r) => setTimeout(r, retryMs));
        try {
          await firstValueFrom(
            this.http.delete(url, { headers: this.headers }),
          );
        } catch (e2) {
          this.logger.warn(`${label} retry failed: ${this.errMsg(e2)}`);
        }
      } else {
        this.logger.warn(`${label} failed: ${this.errMsg(e)}`);
      }
    }
  }

  /** Returns retry delay in ms if the error is a 429, otherwise null. */
  private retryAfterMs(e: unknown): number | null {
    const err = e as AxiosError;
    if (err.response?.status !== 429) return null;
    const body = err.response.data as { retry_after?: number };
    const seconds = body?.retry_after ?? 1;
    return Math.ceil(seconds * 1000) + 100; // +100ms buffer
  }

  private errMsg(e: unknown): string {
    const err = e as AxiosError;
    return `HTTP ${err.response?.status ?? 'unknown'}`;
  }
}
```

- [ ] **Step 2: Create the connector module**

Create `src/connectors/discord/discord-connector.module.ts`:

```ts
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DiscordConnectorService } from './discord-connector.service';

@Module({
  imports: [HttpModule.register({ timeout: 10000, maxRedirects: 3 })],
  providers: [DiscordConnectorService],
  exports: [DiscordConnectorService],
})
export class DiscordConnectorModule {}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npm run lint && npm run build`
Expected: no errors. (The service is not yet imported anywhere; it must still compile cleanly.)

- [ ] **Step 4: Commit**

```bash
git add src/connectors/discord/discord-connector.service.ts src/connectors/discord/discord-connector.module.ts
git commit -m "feat(discord): v2 connector to toggle a guild member role"
```

---

### Task 2: PlayerRepository.findDiscordIdsByIds

**Files:**
- Modify: `src/repos/player.repository.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `interface PlayerDiscordId { id: string; discordId: string | null }`
  - `PlayerRepository.findDiscordIdsByIds(ids: string[]): Promise<PlayerDiscordId[]>`

- [ ] **Step 1: Add the interface**

In `src/repos/player.repository.ts`, add this interface directly below the existing `VerificationPlayer` interface (after line 10):

```ts
/** Discord link for a subset of `player` rows (nulls = not linked). */
export interface PlayerDiscordId {
  id: string;
  discordId: string | null;
}
```

- [ ] **Step 2: Add the query method**

In the same file, add this method to the `PlayerRepository` class, immediately after `findByIds` (after its closing brace, before `applyResults`):

```ts
  /**
   * Discord IDs for the given player ids (v1-owned `player.discordId`). Rows
   * without a linked Discord return `discordId: null`; missing ids are omitted.
   */
  async findDiscordIdsByIds(ids: string[]): Promise<PlayerDiscordId[]> {
    if (ids.length === 0) return [];
    return this.dataSource.query<PlayerDiscordId[]>(
      `SELECT "id", "discordId" FROM "player" WHERE "id" = ANY($1)`,
      [ids],
    );
  }
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/repos/player.repository.ts
git commit -m "feat(repos): findDiscordIdsByIds for verification voice access"
```

---

### Task 3: Wire grant/revoke into VerificationRequestService

**Files:**
- Modify: `src/use-cases/verification/verification.constants.ts`
- Modify: `src/use-cases/verification/verification.module.ts`
- Modify: `src/use-cases/verification/verification-request.service.ts`

**Interfaces:**
- Consumes:
  - `DiscordConnectorService.grantRole` / `.revokeRole` (Task 1)
  - `DiscordConnectorModule` (Task 1)
  - `PlayerRepository.findDiscordIdsByIds` → `PlayerDiscordId[]` (Task 2)
- Produces: `VERIFICATION_VOICE_ROLE_ID` constant; no new public service API (behavioural change only).

- [ ] **Step 1: Add the role-id constant**

In `src/use-cases/verification/verification.constants.ts`, add at the end of the file:

```ts
/**
 * Discord role granting temporary access to the private verification voice
 * channels. Granted when an admin takes a request into processing, removed on
 * complete/cancel. The role's channel permissions are configured on the Discord
 * server, not here.
 */
export const VERIFICATION_VOICE_ROLE_ID = '1526337913854496922';
```

- [ ] **Step 2: Import the Discord module into VerificationModule**

Edit `src/use-cases/verification/verification.module.ts` to this:

```ts
import { Module } from '@nestjs/common';
import { DiscordConnectorModule } from '../../connectors/discord/discord-connector.module';
import { Dota2Module } from '../../dota2/dota2.module';
import { VerificationRequestService } from './verification-request.service';
import { VerificationSlotService } from './verification-slot.service';

@Module({
  imports: [Dota2Module, DiscordConnectorModule],
  providers: [VerificationSlotService, VerificationRequestService],
  exports: [VerificationSlotService, VerificationRequestService],
})
export class VerificationModule {}
```

- [ ] **Step 3: Import the connector, constant, and inject the service**

In `src/use-cases/verification/verification-request.service.ts`:

Add these imports alongside the existing ones (the `Dota2Service` import is at line 9):

```ts
import { DiscordConnectorService } from '../../connectors/discord/discord-connector.service';
```

Add `VERIFICATION_VOICE_ROLE_ID` to the existing import block from `./verification.constants` (currently imports `ESTABLISHED_TEAM_VERIFIED_COUNT`, `VERIFICATION_REBLOCK_MS`, `utcDateRange`), so it becomes:

```ts
import {
  ESTABLISHED_TEAM_VERIFIED_COUNT,
  VERIFICATION_REBLOCK_MS,
  VERIFICATION_VOICE_ROLE_ID,
  utcDateRange,
} from './verification.constants';
```

Add the injected dependency to the constructor (after `private readonly dota2: Dota2Service,`):

```ts
  constructor(
    private readonly requestRepo: RequestRepository,
    private readonly slotRepo: SlotRepository,
    private readonly teamRepo: TeamRepository,
    private readonly playerRepo: PlayerRepository,
    private readonly dota2: Dota2Service,
    private readonly discord: DiscordConnectorService,
  ) {}
```

- [ ] **Step 4: Add the Discord-ID resolver helper**

In the same file, add this private method just above the existing `private async toView(` method (near the end of the class):

```ts
  /**
   * Discord IDs of the captain (createdByPlayerId) plus every player on the
   * request, deduped, with unlinked players dropped. Used to grant/revoke the
   * temporary verification voice-access role.
   */
  private async verificationDiscordIds(
    request: VerificationRequest,
  ): Promise<string[]> {
    const playerIds = new Set<string>([
      request.createdByPlayerId,
      ...request.players.map((p) => p.player.id),
    ]);
    const rows = await this.playerRepo.findDiscordIdsByIds([...playerIds]);
    return rows
      .map((r) => r.discordId)
      .filter((d): d is string => d != null && d !== '');
  }
```

- [ ] **Step 5: Grant on `process`**

In `process(id)`, replace the line:

```ts
    // TODO: notify the captain + players that the request is being processed
```

with:

```ts
    // Open temporary Discord voice access for the captain + players being verified.
    const discordIds = await this.verificationDiscordIds(request);
    void this.discord.grantRole(discordIds, VERIFICATION_VOICE_ROLE_ID);
```

- [ ] **Step 6: Revoke on `complete`**

In `complete(id, input)`, replace the line:

```ts
    // TODO: notify the captain + players that verification completed
```

with:

```ts
    // Close the temporary verification voice access — the session is over.
    const discordIds = await this.verificationDiscordIds(request);
    void this.discord.revokeRole(discordIds, VERIFICATION_VOICE_ROLE_ID);
```

- [ ] **Step 7: Revoke on `cancel` (processing branch only)**

In `cancel(id)`, the **processing** branch ends with the transaction and the line:

```ts
    // TODO: notify the captain + players that the request was cancelled
    return this.toView({
      ...request,
      status: VerificationRequestStatus.Cancelled,
    });
```

Replace that trailing `// TODO: notify ...` comment (the one after the processing-branch transaction, ~line 273) with:

```ts
    // Close the temporary verification voice access opened at processing time.
    const discordIds = await this.verificationDiscordIds(request);
    void this.discord.revokeRole(discordIds, VERIFICATION_VOICE_ROLE_ID);
```

Leave the earlier `// TODO: notify ...` comment in the **pending** branch (~line 250) unchanged — a pending request never entered processing, so it never held the role.

- [ ] **Step 8: Verify it compiles and lints**

Run: `npm run lint && npm run build`
Expected: no errors. Confirm `VerificationRequestService` resolves `DiscordConnectorService` (it does via `DiscordConnectorModule` added in Step 2).

- [ ] **Step 9: Commit**

```bash
git add src/use-cases/verification/verification.constants.ts src/use-cases/verification/verification.module.ts src/use-cases/verification/verification-request.service.ts
git commit -m "feat(verification): grant/revoke Discord voice-access role on process/complete/cancel"
```

---

## Feature verification (manual smoke test)

Run once against a Discord test guild (bot present, `DISCORD_BOT_TOKEN` + `DISCORD_SYNC_GUILD_ID` set, and the role `1526337913854496922` given View/Connect on the private verification voice category):

1. Start v2: `npm run start:dev:v2`.
2. As a captain (a player with a linked `discordId`), book a verification slot, then as an admin `POST /verification/requests/:id/process`.
   - **Expect:** the captain and every request player with a linked Discord receive role `1526337913854496922` and can now see/join the verification voice channels.
3. `POST /verification/requests/:id/complete` with valid results.
   - **Expect:** the role is removed from all of them.
4. Repeat 2, then `POST /verification/requests/:id/cancel` instead.
   - **Expect:** the role is removed. (Cancelling a still-`pending` request grants/removes nothing.)
5. Sanity: with the bot token unset, `process`/`complete`/`cancel` still return normally (no-op Discord calls, warnings logged) — confirms fire-and-forget safety.

## Out-of-band setup (not code)

- **Discord (one-time, admin):** grant role `1526337913854496922` View Channel + Connect on the private verification voice category so holding the role actually unlocks the channels.
- **Deploy:** nothing — `DISCORD_BOT_TOKEN` + `DISCORD_SYNC_GUILD_ID` are already set inline in `.github/workflows/deploy.yml` and forwarded to `api-v2` via the shared `&common` `environment:` anchor in `docker-compose.yml`.
