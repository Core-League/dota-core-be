# Playoff Restart — Design

**Date:** 2026-07-31
**Status:** Approved

## Problem

There is no way to restart a playoff. `POST /tournaments/:id/playoff/start` guards with
`ConflictException('Playoff already started')` as soon as a `playoff` row exists, so a playoff
that was started with the wrong participants, wrong seeding, or bad results can only be fixed
by hand-editing the database and Challonge.

Two existing paths already rebuild a bracket — `disqualifyTeam` and
`techLossWithRebuild` → `rebuildChallongeBracket` — but both **replay existing results** onto the
fresh Challonge tournament. Neither wipes state, and neither re-derives the participant list.

## Goal

One admin endpoint that returns a tournament's playoff to the exact state a first-ever
auto-start would have produced: participants re-derived from current qualification standings,
seeds recomputed, a brand-new Challonge bracket, a brand-new Dota league mirror, and no prior
results or disqualifications.

## Endpoint

```
POST /tournaments/:id/playoff/restart
Guards: JwtAuthGuard, AdminGuard
Body:   none
Returns: PlayoffResponseDto   (same shape as /playoff/start)
```

Backed by a new `PlayoffService.restartPlayoff(tournamentId)`.

## Semantics

End state is identical to a first-ever `autoStartPlayoff`:

- Participants re-derived as the top `PLAYOFF_TEAM_LIMIT` (8) eligible teams by current
  qualification standings — `findEligibleQualificationTeamIds` →
  `selectTopTeamsByStandings(…, 8)`.
- Seeds recomputed from captain `PlayerTournamentPoints` for the tournament.
- Fresh Challonge tournament; fresh Dota league mirror.
- All prior `playoff_series`, `playoff_match`, `playoff_league_fixture` rows gone.
- All `tournament_playoff_team.isDisqualified` flags cleared — **clean slate**. A previously
  disqualified team can be re-selected if standings put it in the top 8; an admin who still
  wants it out must re-disqualify after the restart.

**Self-healing:** if no `playoff` row exists (e.g. a prior restart died mid-flight), restart does
*not* 404 — it proceeds as a plain start. Without this, a half-failed restart would be an
unrecoverable dead end. Tournament status is not gated on either: a restart against a tournament
still in `QUALIFICATIONS` simply starts the playoff, and `startPlayoff` moves the status to
`PLAYOFF` as it always does.

## Schema facts this design relies on

Verified against `src/migrations/1780358677674-InitialSchema.ts`:

- `playoff.tournamentId` is UNIQUE (`REL_3ca4da1280ecb0aaa89bf3ae80`) — the old row **must** be
  deleted before a new one can be inserted. Hence wipe-then-start, not start-then-swap.
- `playoff_series.playoffId`, `playoff_match.playoffId`, `playoff_match.seriesId`, and
  `playoff_league_fixture.playoffId` all FK to their parent `ON DELETE CASCADE` — one `DELETE`
  on the `playoff` row wipes the entire subtree.
- `tournament_playoff_team` is *only* the playoff participant list. Eligibility is derived from
  `qualification_match` + `tournament_team` (see `tournament-playoff-team.eligibility.ts`), never
  from `tournament_playoff_team`, so wiping it destroys no qualification data.

## Order of operations

Validate → teardown → rebuild → best-effort external GC.

1. **Validate before destroying anything.** Load the tournament (404 if missing). Re-derive the
   team set. If fewer than **2** teams, throw `BadRequestException` and leave the existing
   playoff completely untouched.
   *Rationale:* `startPlayoff` today only rejects a zero-team list, but a 1-participant Challonge
   bracket is nonsense; `rebuildChallongeBracket` already enforces ≥2, so this matches.

2. **Capture external handles in memory** from the old playoff, before the wipe removes them:
   `challongeUrl`, `dotaPlayoffContainingNodeGroupId`, and every
   `playoff_league_fixture.dotaFixtureNodeGroupId`.

3. **Teardown, in one transaction:**
   - `DELETE FROM playoff WHERE "tournamentId" = :id` (cascades series, matches, fixtures)
   - `DELETE FROM tournament_playoff_team WHERE "tournamentId" = :id` (clears participants *and*
     DQ flags)

   Tournament status is deliberately left at `PLAYOFF`. `TournamentPlayoffScheduler` sweeps only
   `QUALIFICATIONS` tournaments every minute, so leaving the status alone means the scheduler can
   never race a restart, and a crash mid-restart cannot trigger a surprise auto-start.

4. **Rebuild** by calling the existing `startPlayoff(tournamentId, freshTeamIds)` unchanged. Its
   `ConflictException` guard now passes because step 3 removed the row. Bracket creation, series
   creation, BO3 child placeholders, and Dota mirroring all stay single-sourced in `startPlayoff`.

   Two of `startPlayoff`'s internals are worth noting, as both work unmodified here:
   `mergeStagedPlayoffTeamsWithRequested` finds zero staged rows after the wipe, so the merged
   list is exactly `freshTeamIds`; and its eligibility check validates against
   `findEligibleQualificationTeamIds`, the same source step 1 derived from, so it always passes.

5. **Best-effort GC of the old externals**, only after the new bracket is live:
   `challonge.deleteTournament(oldUrl)`, then `dota2.removeNodeGroup(...)` for each captured
   fixture node group and the old shell. Each call try/caught and `logger.warn`-ed on failure —
   the same pattern `rebuildChallongeBracket` uses for its old-tournament cleanup. A dead external
   handle must never fail a restart whose new bracket is already live.

### Failure profile

The only window where a tournament has status `PLAYOFF` and no bracket is between steps 3 and 4.
Retrying the same endpoint recovers cleanly, because of the self-healing rule above.

## Code layout

`playoff.service.ts` is already ~2,000 lines / 65 KB. Teardown goes in its own unit rather than
growing that file further.

**New `src/playoff/playoff-teardown.service.ts`** — one job: destroy a playoff's state. Injected
into `PlayoffService`, registered in `playoff.module.ts`. Three methods:

| Method | Responsibility |
|---|---|
| `captureExternalHandles(playoff)` | Read `{ challongeUrl, shellNodeGroupId, fixtureNodeGroupIds[] }` before the wipe |
| `wipePlayoffState(tournamentId)` | The single transaction of step 3 |
| `releaseExternals(handles)` | Best-effort `challonge.deleteTournament` + per-node-group `dota2.removeNodeGroup`, each try/caught and logged |

Depends only on `DataSource`, `ChallongeService`, `Dota2Service` — unit-testable without loading
the 2,000-line service.

**`PlayoffService.restartPlayoff(tournamentId)`** — thin orchestrator (~30 lines):
validate → capture → wipe → `this.startPlayoff(id, freshTeamIds)` → `releaseExternals`.

**Extract `private deriveTopEligibleTeamIds(tournamentId)`** from `autoStartPlayoff` — the
`findEligibleQualificationTeamIds` → `selectTopTeamsByStandings(…, PLAYOFF_TEAM_LIMIT)` pair —
and call it from both `autoStartPlayoff` and `restartPlayoff`, so "how participants are chosen"
lives in one place and the restart cannot silently drift from auto-start.

**Controller:** one handler in `tournaments.controller.ts` beside `startPlayoff`, with
`@ApiOperation` and `@ApiOkResponse({ type: PlayoffResponseDto })`. No DTO — no request body.

## Known pre-existing leak — deliberately out of scope

`discardPlayoffLeagueMirroring` deletes `playoff_league_fixture` rows and nulls
`dotaPlayoffContainingNodeGroupId`, but never calls `dota2.removeNodeGroup`. Every
`disqualifyTeam` and tech-loss rebuild therefore orphans Dota league node groups. Because
`ensureDotaOrganizationalShell` creates a shell and then calls `resolveOrganizationalNodeGroupId()`,
accumulated stale shells also carry a risk of resolving the wrong group.

**Decision:** `releaseExternals` is called by `restartPlayoff` only.
`discardPlayoffLeagueMirroring` keeps its current behavior, so `disqualifyTeam` and tech-loss
rebuilds still leak. This keeps the change's blast radius to the one new endpoint rather than
altering three endpoints already running in production. Worth revisiting separately.

## Testing

Per `CLAUDE.md`, tests are written only on request, so none are planned.
`playoff-teardown.service.ts` is structured to be unit-testable if that changes.
