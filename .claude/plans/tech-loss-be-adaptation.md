# Plan: Tech Loss BE Adaptation

> Related UI plan: [Tech Loss Modal Redesign](./tech-loss-modal-redesign.md)

## Context

The Tech Loss Modal Redesign (FE) introduced clickable team cards that display team logos. The backend already has the core endpoints implemented (unstaged on `dev`), but several gaps remain before the feature is production-ready.

## What's already implemented (unstaged on dev)

- `GET /tournaments/:id/playoff/open-matches` → `PlayoffService.getOpenMatches()`
- `POST /tournaments/:id/playoff/tech-loss` → `PlayoffService.techLossMatch()` with two paths:
  - `techLossOpenMatch` — reports the result on the existing open Challonge match
  - `techLossWithRebuild` → `rebuildChallongeBracket` — corrects a wrong result + replays the bracket on a fresh Challonge tournament
- `ChallongeService.listOpenMatches()` (new)
- `AdminService.overrideMatchResult()` made idempotent with point reversal (re-override path)
- `Dota2Service.addLeagueAdmin()` / `revokeLeagueAdmin()` wired into all verify/unverify/captain-change flows
- `TechLossPlayoffDto`, `OpenPlayoffMatchDto` DTOs

## Architectural decisions

- **Endpoints**: no new routes — the two playoff endpoints and the admin override endpoint cover all cases
- **Bracket rebuild strategy**: create a fresh Challonge tournament, replay all corrected match history, delete the old one
- **Qual tech loss**: reuses `POST /admin/matches/:matchId/result` (idempotent override); no separate qual endpoint
- **Point system**: winner = 100 pts, loser = 40 pts (defaults in `OverrideMatchResultDto`)
- **dotaMatchId sentinel**: `tech_loss_<timestamp>` marks tech-loss results in the DB

---

## Phase 1: Add logoUrl to OpenPlayoffMatchDto

**Gap**: `OpenPlayoffMatchTeamDto` only exposes `{ id, name }`. The `MatchTeamSelectCard` component accepts `logoUrl?: string | null` — without it, playoff tech loss cards always show the fallback icon.

### What to build

- Add `logoUrl: string | null` to `OpenPlayoffMatchTeamDto`
- `PlayoffService.getOpenMatches()` already loads `relations: ['team']`, so `row.team.logoUrl` is available — pass it through in the returned object
- Update `TOpenMatch.teamA / teamB` type in `TechLossPlayoffModal.vue` to include `logoUrl?: string | null`
- Update `fetchPlayoffOpenMatches()` return type in `tournaments.service.ts` to include `logoUrl`

### Acceptance criteria

- [ ] `GET /tournaments/:id/playoff/open-matches` response includes `teamA.logoUrl` and `teamB.logoUrl`
- [ ] `null` is returned when the team has no logo (not omitted)
- [ ] Playoff tech loss modal renders the team logo image when `logoUrl` is non-null
- [ ] Fallback icon shows when `logoUrl` is null/undefined

---

## Phase 2: OpenAPI schema regeneration + typed FE service calls

**Gap**: `schema.d.ts` in CoreFrontend is out of date. `fetchPlayoffOpenMatches` and `adminTechLossPlayoffMatch` in `tournaments.service.ts` use raw template-literal URL strings instead of the typed `dynamicKeys` pattern, bypassing schema validation.

### What to build

- Generate the updated OpenAPI spec from the running backend (`npm run build` + Swagger export or `npx @openapitools/openapi-generator-cli`)
- Sync `CoreFrontend/src/api/types/schema.d.ts` with the new spec
- Refactor `fetchPlayoffOpenMatches` to use the typed API client pattern:
  ```ts
  apiClient.get('/tournaments/{id}/playoff/open-matches', { dynamicKeys: { id: tournamentId } })
  ```
- Refactor `adminTechLossPlayoffMatch` similarly
- Derive `TOpenPlayoffMatch` from the updated schema rather than inline type in the service

### Acceptance criteria

- [ ] `schema.d.ts` includes `OpenPlayoffMatchDto`, `OpenPlayoffMatchTeamDto`, `TechLossPlayoffDto` types
- [ ] `fetchPlayoffOpenMatches` uses typed API client call (no raw template literals)
- [ ] `adminTechLossPlayoffMatch` uses typed API client call
- [ ] `TOpenMatch` in the playoff modal is derived from the schema type (no duplicate inline shape)
- [ ] TypeScript compiles without errors across both projects

---

## Phase 3: Harden rebuildChallongeBracket

**Gap**: `rebuildChallongeBracket` is a multi-step destructive operation (creates new tournament, replays all matches, deletes old tournament). Several edge cases are unguarded:

1. If `findOpenMatch` throws during replay (match doesn't exist in new bracket or is already reported), the partial state is left with an inconsistent `challongeMatchId` in the DB.
2. If the new tournament creation succeeds but `startTournament` fails, the old tournament is already being abandoned.
3. No guard against zero active participants (degenerate bracket).
4. `"createdAt" > :cutoff` deletion in `techLossWithRebuild` relies on column existing and being indexed — `PlayoffMatch.createdAt` must be confirmed to exist on the entity.

### What to build

- Wrap the entire `rebuildChallongeBracket` body in a DB transaction; only update `playoff` row after all match replays succeed
- Add a guard: if `activeRows.length < 2`, throw `BadRequestException` with a clear message before touching Challonge
- In the replay loop, catch `findOpenMatch` errors per-match and log a warning (skip the match) rather than crashing mid-rebuild — the bracket may legitimately have matches that haven't been reached yet in the new bracket
- Confirm `PlayoffMatch.createdAt` exists on the entity and is set by TypeORM `@CreateDateColumn`; add it if missing
- Add a `try/catch` around the `deleteTournament` call (already present) and log the old URL so it can be cleaned up manually if needed

### Acceptance criteria

- [ ] `rebuildChallongeBracket` is wrapped in a DataSource transaction
- [ ] Zero-participant guard throws before any Challonge API call
- [ ] Per-match `findOpenMatch` failures are caught and logged, not propagated
- [ ] `PlayoffMatch` entity has `@CreateDateColumn() createdAt` (add migration if missing)
- [ ] `techLossWithRebuild` deletion query is tested against a match created in the same transaction (no timing ambiguity)
- [ ] `npm run lint` passes with no new errors
