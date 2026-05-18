# Playoff Bracket — Design Spec

**Date:** 2026-05-19

## Problem

The playoff team roster can now be managed, but there is no bracket, no match submission flow, and no way for the FE to display the playoff grid. Challonge will own the bracket logic (double elimination, advancement, byes for uneven counts). Our backend creates the bracket, stores the embed URL, and syncs match results to Challonge when verified via the Dota2 API.

---

## Data Layer

### New entity: `Playoff`

Lives in `src/playoff/playoff.entity.ts`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tournamentId` | UUID FK | → `tournament.id`, unique (OneToOne) |
| `challongeTournamentId` | varchar | Challonge's internal tournament ID |
| `challongeUrl` | varchar | Challonge URL slug (used for API calls) |
| `challongeEmbedUrl` | varchar | Full embed URL returned to FE |

### New entity: `PlayoffMatch`

Lives in `src/playoff/playoff-match.entity.ts`. Mirrors `QualificationMatch` pattern.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `playoffId` | UUID FK | → `playoff.id` (ManyToOne) |
| `teamAId` | UUID FK | → `team.id` |
| `teamBId` | UUID FK | → `team.id` |
| `winnerId` | UUID FK nullable | → `team.id` |
| `dotaMatchId` | varchar nullable | Dota2 match ID submitted |
| `challongeMatchId` | varchar | Challonge match ID |
| `createdAt` | timestamptz | Set on insert; used to replay results in order after disqualification |

### Modified entity: `TournamentPlayoffTeam`

Add two columns:

| Column | Type | Notes |
|---|---|---|
| `challongeParticipantId` | varchar nullable | Set when bracket is created |
| `isDisqualified` | boolean | Default false; set by disqualification endpoint |

### Migrations

Two new migrations:
1. `1746900000000-AddPlayoff` — creates `playoff` and `playoff_match` tables
2. `1746900000001-AddChallongeParticipantId` — adds `challongeParticipantId` and `isDisqualified` columns to `tournament_playoff_team`

---

## New Module: `playoff/`

`src/playoff/playoff.module.ts` — parallel to `qualification/`. Exports `PlayoffService` so `TournamentsModule` can use it.

Files:
- `src/playoff/playoff.entity.ts`
- `src/playoff/playoff-match.entity.ts`
- `src/playoff/playoff.repository.ts`
- `src/playoff/playoff-match.repository.ts`
- `src/playoff/playoff.service.ts`
- `src/playoff/playoff.module.ts`
- `src/playoff/dto/submit-playoff-match.dto.ts`

---

## New Module: `challonge/`

`src/challonge/challonge.module.ts` — thin HTTP client around the Challonge API v1. Uses NestJS `HttpModule` (axios). Exported globally so any module can import it.

**Env vars required:**
- `CHALLONGE_API_KEY` — added to `.env.dev` and `.env.staging`

**Base URL:** `https://api.challonge.com/v1` (hardcoded).

Files:
- `src/challonge/challonge.service.ts`
- `src/challonge/challonge.module.ts`

### `ChallongeService` methods

All methods append `api_key` as a query param and use `Content-Type: application/json`.

| Method | Challonge call | Purpose |
|---|---|---|
| `createTournament(name, slug)` | `POST /tournaments.json` `tournament[tournament_type]=double_elimination` | Returns `{ id, url }` |
| `bulkAddParticipants(url, participants: { name, seed }[])` | `POST /tournaments/{url}/participants/bulk_add.json` | Returns `[{ name, id }]` |
| `startTournament(url)` | `POST /tournaments/{url}/start.json` | Generates bracket |
| `findOpenMatch(url, participantIdA, participantIdB)` | `GET /tournaments/{url}/matches.json?state=open` | Returns the open match between these two participants |
| `reportMatchResult(url, matchId, winnerParticipantId)` | `PUT /tournaments/{url}/matches/{matchId}.json` `match[winner_id]`, `match[scores_csv]=1-0` | Advances bracket |
| `deleteTournament(url)` | `DELETE /tournaments/{url}.json` | Used during disqualification to tear down old bracket |

Embed URL is constructed as: `https://challonge.com/{url}/module`

---

## Endpoints

All three endpoints are added to `TournamentsController`. `PlayoffService` is injected alongside `QualificationService`.

### `POST /tournaments/:id/playoff/start`

**Auth:** Admin only (`JwtAuthGuard + AdminGuard`)
**Body:** `{ teamIds: string[] }`
**One-time action — not idempotent.** Returns 409 if playoff already started for this tournament.

Flow:
1. 404 if tournament not found
2. 409 if `Playoff` record already exists for this tournament
3. Validate each `teamId` has at least one verified `QualificationMatch` in this tournament (`winner IS NOT NULL`) — 400 with invalid IDs if any fail
4. Save `TournamentPlayoffTeam` rows (reuses existing repo)
5. Compute seeds: for each team, get the captain's `PlayerTournamentPoints.points` for this tournament; sort teams descending; assign seed 1 to highest, 2 to next, etc. Teams with no points get seed after all teams with points (stable sort).
6. Create Challonge tournament: name = tournament name, slug = `core-{tournamentId}` (first 8 chars of UUID)
7. Bulk-add participants with seeds → store `challongeParticipantId` on each `TournamentPlayoffTeam`
8. Start Challonge tournament
9. Save `Playoff` entity (challongeTournamentId, challongeUrl, challongeEmbedUrl)
10. Set `tournament.tournamentStatus = PLAYOFF`
11. Return `{ embedUrl: string, teams: TeamResponseDto[] }`

### `POST /tournaments/:id/playoff/submit`

**Auth:** JWT required
**Body:** `{ dotaMatchId: string }`

Flow:
1. 404 if tournament or `Playoff` record not found
2. Call Dota2 API with `dotaMatchId` → get `dotaTeamIdA`, `dotaTeamIdB`, winner team's `dotaTeamId`
3. Find the two `TournamentPlayoffTeam` rows by team's `dotaTeamId` (via team entity)
4. Get their `challongeParticipantId`
5. Call `challongeService.findOpenMatch(challongeUrl, participantIdA, participantIdB)` → get `challongeMatchId`
6. Determine winner's `challongeParticipantId`
7. Call `challongeService.reportMatchResult(challongeUrl, challongeMatchId, winnerParticipantId)` — bracket advances on Challonge side automatically
8. Save `PlayoffMatch` (teamA, teamB, winner, dotaMatchId, challongeMatchId)
9. Return the saved `PlayoffMatch`

No points are awarded during playoff.

### `POST /tournaments/:id/playoff/disqualify`

**Auth:** Admin only (`JwtAuthGuard + AdminGuard`)
**Body:** `{ teamId: string }`

Disqualifies a team mid-playoff and rebuilds the Challonge bracket without them. Because Challonge does not support retroactive bracket rewinding, the tournament is deleted and recreated.

Flow:
1. 404 if tournament or `Playoff` not found
2. 404 if `teamId` is not a playoff participant
3. 400 if team is already disqualified
4. Set `TournamentPlayoffTeam.isDisqualified = true` for the team
5. Clear all `PlayoffMatch` records where the disqualified team appears as `teamA` or `teamB` — delete those rows
6. Delete the existing Challonge tournament (`DELETE /tournaments/{url}.json`)
7. Create a new Challonge tournament (same name, new slug: `core-{tournamentId}-{timestamp}`)
8. Bulk-add all non-disqualified playoff teams with their original seeds; update `challongeParticipantId` on each `TournamentPlayoffTeam`
9. Start the new Challonge tournament
10. Re-report all remaining valid `PlayoffMatch` records in chronological order by `createdAt` (matches where neither team is disqualified) — this rebuilds the bracket state
11. Update `Playoff` entity with new `challongeTournamentId`, `challongeUrl`, `challongeEmbedUrl`
12. Return `{ embedUrl: string, teams: TeamResponseDto[] }` (teams excludes disqualified team)

### `GET /tournaments/:id/playoff`

**Auth:** None (public)

Returns `{ embedUrl: string, teams: TeamResponseDto[] }` (only non-disqualified teams) or 404 if playoff not started.

---

## Existing Endpoints (unchanged)

The team management endpoints built previously remain:
- `GET /tournaments/:id/playoff/teams` — current playoff roster
- `POST /tournaments/:id/playoff/teams` — pre-staging: add teams before committing
- `DELETE /tournaments/:id/playoff/teams` — pre-staging: remove teams before committing
- `GET /tournaments/:id/qualification/teams` — eligible teams for admin picker

These are useful for the admin to build the team list in the FE before hitting `/playoff/start`.

---

## Environment

Add to `.env.dev` and `.env.staging`:
```
CHALLONGE_API_KEY=
```

---

## Out of Scope

- Challonge webhook integration (bracket status is read via GET on demand, not pushed)
- Bracket finalization / setting tournament to COMPLETED
- Points or ranking changes from playoff results
- Replay of already-submitted playoff matches
