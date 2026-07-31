# Playoff Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /tournaments/:id/playoff/restart` — an admin endpoint that returns a tournament's playoff to the exact state a first-ever auto-start would have produced.

**Architecture:** A new `PlayoffTeardownService` owns destruction (capture external handles → wipe DB state → best-effort external GC). `PlayoffService.restartPlayoff` is a thin orchestrator that validates first, tears down, then delegates the rebuild to the **existing, unmodified** `startPlayoff`. Participant derivation is extracted from `autoStartPlayoff` into a shared private helper so auto-start and restart cannot drift apart.

**Tech Stack:** NestJS 11, TypeORM 0.3, PostgreSQL 16, Swagger via `@nestjs/swagger`.

**Spec:** `docs/superpowers/specs/2026-07-31-playoff-restart-design.md`

## Global Constraints

- **No tests.** `CLAUDE.md`: "run or write test only upon request user". Every task's verification gate is `npm run build` + `npm run lint`, not a test run. Do not add `.spec.ts` files.
- **Do not modify `startPlayoff`.** The rebuild path must stay single-sourced. Restart calls it as-is.
- **Do not modify `discardPlayoffLeagueMirroring`.** The pre-existing Dota node-group leak in `disqualifyTeam` / tech-loss rebuilds is deliberately out of scope (spec: "Known pre-existing leak"). `releaseExternals` is called by `restartPlayoff` only.
- **Participant limit is the existing `PLAYOFF_TEAM_LIMIT = 8`** constant in `src/playoff/playoff.service.ts:35`. Do not introduce a second limit.
- **Minimum 2 teams** to restart. Validation runs *before* any destruction.
- **Tournament status is left alone during restart** — never set it to `QUALIFICATIONS`. `TournamentPlayoffScheduler` sweeps only `QUALIFICATIONS`, so leaving it means the scheduler cannot race a restart.
- **All external cleanup is best-effort:** every `challonge.*` / `dota2.*` call in the teardown path is individually try/caught and `logger.warn`-ed. Never let a dead external handle fail a restart whose new bracket is already live.
- Branch is already created: `feat/playoff-restart`. Commit per task.

---

### Task 1: PlayoffTeardownService

Owns all destruction. Isolated from the ~2,000-line `playoff.service.ts` so it can be reasoned about (and later unit-tested) on its own. Depends only on `DataSource`, `ChallongeService`, `Dota2Service`.

**Files:**
- Create: `src/playoff/playoff-teardown.service.ts`
- Modify: `src/playoff/playoff.module.ts:29` (providers array)

**Interfaces:**
- Consumes: `ChallongeService.deleteTournament(url: string): Promise<void>`; `Dota2Service.removeNodeGroup(nodeGroupId: string): Promise<void>`; `Dota2Service.isLeagueApiConfigured(): boolean`
- Produces:
  - `export interface PlayoffExternalHandles { challongeUrl: string | null; shellNodeGroupId: string | null; fixtureNodeGroupIds: string[] }`
  - `PlayoffTeardownService.captureExternalHandles(playoff: Playoff): Promise<PlayoffExternalHandles>`
  - `PlayoffTeardownService.wipePlayoffState(tournamentId: string): Promise<void>`
  - `PlayoffTeardownService.releaseExternals(handles: PlayoffExternalHandles): Promise<void>`

- [ ] **Step 1: Create the teardown service**

Create `src/playoff/playoff-teardown.service.ts` with exactly this content:

```ts
// src/playoff/playoff-teardown.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChallongeService } from '../challonge/challonge.service';
import { Dota2Service } from '../dota2/dota2.service';
import { TournamentPlayoffTeam } from '../tournaments/tournament-playoff-team.entity';
import { PlayoffLeagueFixture } from './playoff-league-fixture.entity';
import { Playoff } from './playoff.entity';

/**
 * External resources a playoff owns outside our DB. Captured before the wipe, because the
 * wipe deletes the rows these ids live in.
 */
export interface PlayoffExternalHandles {
  challongeUrl: string | null;
  shellNodeGroupId: string | null;
  fixtureNodeGroupIds: string[];
}

/** Destroys everything a playoff owns: DB rows first, external resources best-effort after. */
@Injectable()
export class PlayoffTeardownService {
  private readonly logger = new Logger(PlayoffTeardownService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly challonge: ChallongeService,
    private readonly dota2: Dota2Service,
  ) {}

  /**
   * Reads every external handle the playoff owns.
   * MUST run before `wipePlayoffState` — that call deletes the rows holding these ids.
   */
  async captureExternalHandles(
    playoff: Playoff,
  ): Promise<PlayoffExternalHandles> {
    const fixtures = await this.dataSource
      .getRepository(PlayoffLeagueFixture)
      .find({
        where: { playoffId: playoff.id },
        select: ['dotaFixtureNodeGroupId'],
      });

    const fixtureNodeGroupIds = [
      ...new Set(
        fixtures
          .map((f) => (f.dotaFixtureNodeGroupId ?? '').trim())
          .filter((id) => id.length > 0),
      ),
    ];

    return {
      challongeUrl: (playoff.challongeUrl ?? '').trim() || null,
      shellNodeGroupId:
        (playoff.dotaPlayoffContainingNodeGroupId ?? '').trim() || null,
      fixtureNodeGroupIds,
    };
  }

  /**
   * Deletes all DB state a playoff owns, in one transaction:
   * - the `playoff` row — cascades `playoff_series`, `playoff_match` and
   *   `playoff_league_fixture` (their FKs are ON DELETE CASCADE);
   * - the `tournament_playoff_team` rows — clears the participant list *and* every
   *   `isDisqualified` flag, so a restart re-derives participants from a clean slate.
   *
   * Safe to call when no playoff exists: both deletes are no-ops then.
   */
  async wipePlayoffState(tournamentId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Playoff).delete({ tournamentId });
      await manager
        .getRepository(TournamentPlayoffTeam)
        .delete({ tournamentId });
    });
  }

  /**
   * Best-effort cleanup of the *old* Challonge tournament and Dota league node groups.
   * Every failure is logged and swallowed: the replacement bracket is already live when this
   * runs, so a stale external handle must never fail the restart. Fixture groups are removed
   * before the shell that contains them.
   */
  async releaseExternals(handles: PlayoffExternalHandles): Promise<void> {
    if (handles.challongeUrl) {
      try {
        await this.challonge.deleteTournament(handles.challongeUrl);
      } catch (err) {
        this.logger.warn(
          `Failed to delete old Challonge tournament ${handles.challongeUrl} — clean up manually`,
          err,
        );
      }
    }

    if (!this.dota2.isLeagueApiConfigured()) return;

    const nodeGroupIds = [
      ...handles.fixtureNodeGroupIds,
      ...(handles.shellNodeGroupId ? [handles.shellNodeGroupId] : []),
    ];

    for (const nodeGroupId of nodeGroupIds) {
      try {
        await this.dota2.removeNodeGroup(nodeGroupId);
      } catch (err) {
        this.logger.warn(
          `Failed to remove old Dota league node group ${nodeGroupId} — clean up manually`,
          err,
        );
      }
    }
  }
}
```

- [ ] **Step 2: Register the provider**

In `src/playoff/playoff.module.ts`, add the import beside the other local imports:

```ts
import { PlayoffTeardownService } from './playoff-teardown.service';
```

and replace the `providers` line:

```ts
  providers: [
    PlayoffService,
    PlayoffRepository,
    PlayoffMatchRepository,
    PlayoffTeardownService,
  ],
```

Leave `exports` unchanged — only `PlayoffService` is consumed outside this module.

`ChallongeModule` and `Dota2Module` are already in this module's `imports` (lines 24-25), so both injected services resolve with no further wiring.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Verify lint is clean**

Run: `npm run lint`
Expected: exits 0. (This auto-fixes formatting; if it rewrites the file, that is fine — include the result in the commit.)

- [ ] **Step 5: Commit**

```bash
git add src/playoff/playoff-teardown.service.ts src/playoff/playoff.module.ts
git commit -m "feat(playoff): add PlayoffTeardownService for full playoff destruction"
```

---

### Task 2: Extract shared participant derivation

Pure refactor, no new behavior. Pulls the "top N eligible teams by standings" logic out of `autoStartPlayoff` so Task 3 can reuse it verbatim.

**Files:**
- Modify: `src/playoff/playoff.service.ts:172-209` (`autoStartPlayoff`)

**Interfaces:**
- Consumes: existing module-private `findEligibleQualificationTeamIds(dataSource, tournamentId)` (imported at line 25) and `PlayoffService.selectTopTeamsByStandings(tournamentId, teamIds, limit)` (line 1066); `PLAYOFF_TEAM_LIMIT` (line 35)
- Produces: `private deriveTopEligibleTeamIds(tournamentId: string): Promise<string[]>` — used by Task 3

- [ ] **Step 1: Add the helper method**

In `src/playoff/playoff.service.ts`, insert this method immediately after `autoStartPlayoff` ends (after the closing brace at line 209, before `async submitMatch`):

```ts
  /**
   * Participants for an automatic start or a restart: every team eligible from qualification,
   * cut to the top `PLAYOFF_TEAM_LIMIT` by current standings. Shared by `autoStartPlayoff` and
   * `restartPlayoff` so the two cannot drift apart on how the field is chosen.
   *
   * Returns an empty array when nothing is eligible yet.
   */
  private async deriveTopEligibleTeamIds(
    tournamentId: string,
  ): Promise<string[]> {
    const eligibleTeamIds = await findEligibleQualificationTeamIds(
      this.dataSource,
      tournamentId,
    );
    if (eligibleTeamIds.length === 0) return [];

    return this.selectTopTeamsByStandings(
      tournamentId,
      eligibleTeamIds,
      PLAYOFF_TEAM_LIMIT,
    );
  }
```

- [ ] **Step 2: Rewrite autoStartPlayoff's derivation block to call the helper**

In `src/playoff/playoff.service.ts`, replace everything from `const eligibleTeamIds = await findEligibleQualificationTeamIds(` (line 187) through the closing of the `this.logger.log(...)` call at line 206 — i.e. this exact existing block:

```ts
    const eligibleTeamIds = await findEligibleQualificationTeamIds(
      this.dataSource,
      tournamentId,
    );
    if (eligibleTeamIds.length === 0) {
      this.logger.warn(
        `Auto-start skipped for tournament ${tournamentId}: no eligible teams yet`,
      );
      return;
    }

    const playoffTeamIds = await this.selectTopTeamsByStandings(
      tournamentId,
      eligibleTeamIds,
      PLAYOFF_TEAM_LIMIT,
    );
    this.logger.log(
      `Auto-starting playoff for tournament ${tournamentId} with ${playoffTeamIds.length} ` +
        `of ${eligibleTeamIds.length} eligible teams (top ${PLAYOFF_TEAM_LIMIT})`,
    );
```

with:

```ts
    const playoffTeamIds = await this.deriveTopEligibleTeamIds(tournamentId);
    if (playoffTeamIds.length === 0) {
      this.logger.warn(
        `Auto-start skipped for tournament ${tournamentId}: no eligible teams yet`,
      );
      return;
    }

    this.logger.log(
      `Auto-starting playoff for tournament ${tournamentId} with ${playoffTeamIds.length} ` +
        `teams (top ${PLAYOFF_TEAM_LIMIT} by standings)`,
    );
```

Keep the following two lines (`await this.startPlayoff(...)` and the success log) exactly as they are.

**Deliberate change to be aware of:** the auto-start log line no longer reports the total eligible count (`"N of M eligible teams"` becomes `"N teams (top 8 by standings)"`), because that count now lives inside the helper. Behavior is otherwise identical — the empty-list guard still fires under exactly the same condition, since `selectTopTeamsByStandings` returns `[]` only for an empty input.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: exits 0. In particular, no "unused variable" error — `findEligibleQualificationTeamIds` and `PLAYOFF_TEAM_LIMIT` are both still referenced, now from inside the new helper.

- [ ] **Step 4: Verify lint is clean**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/playoff/playoff.service.ts
git commit -m "refactor(playoff): extract deriveTopEligibleTeamIds from autoStartPlayoff"
```

---

### Task 3: restartPlayoff orchestrator

The endpoint's actual logic: validate → capture → wipe → rebuild via `startPlayoff` → release old externals.

**Files:**
- Modify: `src/playoff/playoff.service.ts` — import (near line 32), constructor (lines 41-49), new public method after `autoStartPlayoff`/`deriveTopEligibleTeamIds`

**Interfaces:**
- Consumes: `PlayoffTeardownService` (Task 1) and its three methods; `deriveTopEligibleTeamIds` (Task 2); existing `startPlayoff(tournamentId, requestedTeamIds)` and `playoffRepo.findByTournamentId(tournamentId)`
- Produces: `PlayoffService.restartPlayoff(tournamentId: string): Promise<PlayoffResponseDto>` — called by Task 4

- [ ] **Step 1: Import and inject the teardown service**

In `src/playoff/playoff.service.ts`, add the import beside the other `./playoff-*` imports:

```ts
import { PlayoffTeardownService } from './playoff-teardown.service';
```

Then add one constructor parameter, after `playoffMatchRepo` and before `challonge`:

```ts
  constructor(
    private readonly playoffRepo: PlayoffRepository,
    private readonly playoffMatchRepo: PlayoffMatchRepository,
    private readonly teardown: PlayoffTeardownService,
    private readonly challonge: ChallongeService,
    private readonly dota2: Dota2Service,
    private readonly duelo: DueloService,
    private readonly teamsService: TeamsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}
```

- [ ] **Step 2: Add restartPlayoff**

Insert this method immediately after `deriveTopEligibleTeamIds` (added in Task 2):

```ts
  /**
   * Full playoff reset — same end state as a first-ever auto-start.
   *
   * Re-derives participants from current qualification standings, drops every prior result and
   * disqualification, and rebuilds the Challonge bracket plus Dota league mirror by delegating
   * to `startPlayoff`.
   *
   * Ordering matters:
   * - validation runs before any destruction, so a rejected restart leaves the existing playoff
   *   completely untouched;
   * - external handles are captured before the wipe, which deletes the rows holding them;
   * - old Challonge/Dota resources are released only after the replacement bracket is live.
   *
   * Tournament status is intentionally left as-is. `TournamentPlayoffScheduler` sweeps only
   * `QUALIFICATIONS`, so it can never race a restart, and a crash mid-restart cannot trigger a
   * surprise auto-start. When no playoff exists (e.g. a previous restart died mid-flight) this
   * behaves as a plain start, which makes a failed restart retryable rather than terminal.
   */
  async restartPlayoff(tournamentId: string): Promise<PlayoffResponseDto> {
    const tournament = await this.dataSource
      .getRepository(Tournament)
      .findOne({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const freshTeamIds = await this.deriveTopEligibleTeamIds(tournamentId);
    if (freshTeamIds.length < 2) {
      throw new BadRequestException(
        `Cannot restart playoff: only ${freshTeamIds.length} eligible team(s) in qualification ` +
          'standings, at least 2 required. Existing playoff left untouched.',
      );
    }

    const existing = await this.playoffRepo.findByTournamentId(tournamentId);
    const handles = existing
      ? await this.teardown.captureExternalHandles(existing)
      : null;

    await this.teardown.wipePlayoffState(tournamentId);

    const response = await this.startPlayoff(tournamentId, freshTeamIds);

    if (handles) await this.teardown.releaseExternals(handles);

    this.logger.log(
      `Playoff restarted for tournament ${tournamentId} with ${freshTeamIds.length} teams`,
    );
    return response;
  }
```

Why the `startPlayoff` call needs no changes: after `wipePlayoffState` there is no `playoff` row, so its `ConflictException('Playoff already started')` guard passes; `mergeStagedPlayoffTeamsWithRequested` finds zero staged rows, so the merged list is exactly `freshTeamIds`; and its eligibility check validates against `findEligibleQualificationTeamIds` — the same source `deriveTopEligibleTeamIds` drew from, so it always passes.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: exits 0. `BadRequestException`, `NotFoundException`, `Tournament` and `PlayoffResponseDto` are all already imported in this file (lines 4, 8, 18, 24) — no import additions beyond `PlayoffTeardownService`.

- [ ] **Step 4: Verify lint is clean**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/playoff/playoff.service.ts
git commit -m "feat(playoff): add restartPlayoff full-reset orchestrator"
```

---

### Task 4: Expose the endpoint

**Files:**
- Modify: `src/tournaments/tournaments.controller.ts:298` (insert after the `startPlayoff` handler)

**Interfaces:**
- Consumes: `PlayoffService.restartPlayoff(tournamentId)` (Task 3)
- Produces: `POST /tournaments/:id/playoff/restart` → `PlayoffResponseDto`

- [ ] **Step 1: Add the handler**

In `src/tournaments/tournaments.controller.ts`, insert directly after the closing brace of `startPlayoff` (line 298) and before the `@Post(':id/playoff/submit-manual')` decorator:

```ts
  @Post(':id/playoff/restart')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Restart the playoff from scratch',
    description:
      'Destroys all playoff results, series and disqualifications, re-derives participants from ' +
      'current qualification standings, then rebuilds the Challonge bracket and Dota league ' +
      'mirror. End state matches starting the playoff for the first time. Irreversible.',
  })
  @ApiOkResponse({ type: PlayoffResponseDto })
  restartPlayoff(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.playoffService.restartPlayoff(id);
  }
```

No import changes are needed: `Post`, `Param`, `ParseUUIDPipe`, `UseGuards`, `ApiBearerAuth`, `ApiOperation`, `ApiOkResponse`, `JwtAuthGuard`, `AdminGuard` and `PlayoffResponseDto` are all already imported (lines 1-54). No DTO — the endpoint takes no body.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Verify lint is clean**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/tournaments/tournaments.controller.ts
git commit -m "feat(playoff): expose POST /tournaments/:id/playoff/restart"
```

---

### Task 5: Verify the wired endpoint

Confirms Nest actually resolves the new provider and registers the route — a compile pass alone would not catch a DI failure, which surfaces only at bootstrap.

**Files:** none modified.

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: nothing — verification only.

- [ ] **Step 1: Start the database**

Run: `npm run db:up`
Expected: the local Postgres container is up.

- [ ] **Step 2: Boot the v1 dev server and confirm DI resolves**

Run: `npm run start:dev`
Expected: server listens on port 3000 with **no** Nest DI error. A missing provider would fail here with `Nest can't resolve dependencies of the PlayoffService (..., ?, ...)` naming `PlayoffTeardownService` — if that appears, Task 1 Step 2 was not applied.

Also expect a `RoutesResolver`/`RouterExplorer` log line mapping `{/tournaments/:id/playoff/restart, POST}`.

- [ ] **Step 3: Confirm the route is in the Swagger contract**

Run: `curl -s http://localhost:3000/api-json | grep -o '"/tournaments/{id}/playoff/restart"'`
Expected: prints `"/tournaments/{id}/playoff/restart"`.

If `/api-json` is not served, open `http://localhost:3000/api` in a browser and find **Restart the playoff from scratch** under the `tournaments` tag instead.

- [ ] **Step 4: Confirm the endpoint is admin-guarded**

Run: `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/tournaments/00000000-0000-0000-0000-000000000000/playoff/restart`
Expected: `401` — the guard rejects an unauthenticated call before any playoff logic runs.

- [ ] **Step 5: Live restart (requires real credentials — hand to the operator if unavailable)**

This step needs an admin JWT plus working `CHALLONGE_*` and `DOTA_*` env values, since a restart creates a real Challonge tournament and deletes the old one. If those are not available locally, stop here and report that Steps 1-4 passed and Step 5 is pending an environment with credentials — do **not** mark the task complete.

With credentials, against a tournament that already has a started playoff:

```bash
curl -s -X POST "http://localhost:3000/tournaments/$TOURNAMENT_ID/playoff/restart" \
  -H "Authorization: Bearer $ADMIN_JWT" | jq
```

Expected: `200` with `{ embedUrl, teams }`, where `embedUrl` differs from the pre-restart value.

Then confirm the wipe in Postgres:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM playoff_match m JOIN playoff p ON p.id = m.\"playoffId\" WHERE p.\"tournamentId\" = '$TOURNAMENT_ID';"
psql "$DATABASE_URL" -c "SELECT count(*) FROM tournament_playoff_team WHERE \"tournamentId\" = '$TOURNAMENT_ID' AND \"isDisqualified\" = true;"
```

Expected: `0` for both — no carried-over results, no carried-over disqualifications.

- [ ] **Step 6: Report results**

No commit — this task changes no files. Report which steps passed, and explicitly state whether Step 5 ran or is pending credentials.

---

## Rollback

Every task is a single commit on `feat/playoff-restart`, and nothing here touches migrations or existing endpoint behavior (beyond the auto-start log text in Task 2). To back out: `git revert` the task commits, or drop the branch. No schema change means no migration to revert.
