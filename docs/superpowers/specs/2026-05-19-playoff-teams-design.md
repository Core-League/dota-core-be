# Playoff Teams — Design Spec

**Date:** 2026-05-19

## Problem

The tournament lifecycle supports `QUALIFICATIONS → PLAYOFF → COMPLETED` statuses, but there is no way to record which teams advance to the playoff stage. The `PLAYOFF` status exists only as an enum value with no backing data or endpoints.

## Solution

A separate `tournament_playoff_team` join table tracks which teams are selected for a tournament's playoff. Admins manage the list via dedicated endpoints.

---

## Data Layer

### New entity: `TournamentPlayoffTeam`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tournamentId` | UUID FK | → `tournament.id` |
| `teamId` | UUID FK | → `team.id` |

- Unique constraint on `[tournamentId, teamId]` — enforced at DB level to prevent duplicates.
- Lives in `src/tournaments/tournament-playoff-team.entity.ts`.
- New `TournamentPlayoffTeamRepository` in `src/tournaments/tournament-playoff-team.repository.ts`.

---

## Endpoints

All three endpoints are added to `TournamentsController`. The two mutation endpoints require `AdminGuard`.

### `POST /tournaments/:id/playoff/teams`

Adds teams to the playoff roster.

- **Auth:** Admin only
- **Body:** `{ teamIds: string[] }`
- **Behaviour:** Idempotent — teams already in the list are ignored (no error).
- **Returns:** `201` with the full updated playoff team list.

### `DELETE /tournaments/:id/playoff/teams`

Removes teams from the playoff roster.

- **Auth:** Admin only
- **Body:** `{ teamIds: string[] }`
- **Behaviour:** Idempotent — team IDs not in the list are ignored (no error).
- **Returns:** `200` with the full updated playoff team list.

### `GET /tournaments/:id/playoff/teams`

Returns the current playoff team list.

- **Auth:** None (public, consistent with other GET tournament endpoints)
- **Returns:** `200` with array of teams.

---

## Validation (POST only)

Applied to every `teamId` in the request body:

1. **Tournament exists** — 404 if not found.
2. **Verified qualification match** — the team must appear as `teamA` or `teamB` in at least one `QualificationMatch` belonging to this tournament's qualification where `winner IS NOT NULL`. Teams that only joined but never completed a match are rejected.
3. **Error response** — if any team IDs fail validation, return `400` listing which IDs failed and why.

Division correctness is implicitly enforced by rule 2: a team's verified matches are tied to a specific tournament, so they can only be added to the playoff of the tournament they qualified in.

---

## Service Methods

New methods on `TournamentsService`:

- `addPlayoffTeams(tournamentId, teamIds)` — validates, inserts rows, returns updated list.
- `removePlayoffTeams(tournamentId, teamIds)` — removes rows, returns updated list.
- `getPlayoffTeams(tournamentId)` — returns current list.

---

## Response DTO

`PlayoffTeamResponseDto` — wraps the team data returned by each endpoint. Reuses the existing team response shape already used elsewhere in the tournaments module.

---

## Migration

One migration: creates `tournament_playoff_team` table with the unique constraint.

---

## Out of Scope

- Bracket generation or playoff match scheduling.
- Auto-advancing top-N teams by points.
- Enforcing a maximum number of playoff teams.
- Changing tournament status when teams are added/removed.
