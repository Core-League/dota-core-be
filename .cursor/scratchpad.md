# Scratchpad

## Background and Motivation

NestJS + TypeORM backend (`core-backend`). Executor mode is engaged to implement agreed changes in code.

## Key Challenges and Analysis

- Planner artifact (this file) was missing at handoff; **High-level Task Breakdown** needs to be filled from the user’s requirements.

## High-level Task Breakdown

- [x] Add Player ↔ UserRoles one-to-many relation (Player has roles, role references player). **Success:** Entities compile and expose FK `playerId` on roles with cascade delete.
- [x] Wire repositories in modules. **Success:** `PlayersModule` and `UserRolesModule` register TypeORM features for Player/UserRoles.
- [x] Add Team ↔ Player relations (captain/coach OneToOne, main/reserved players join tables). **Success:** Team entity compiles with `captain`, `coach`, `mainPlayers`, `reservedPlayers` relations and generates FK/through tables.
- [x] Enforce non-null captain and auto-promote first main player on captain removal. **Success:** Team entity captain relation is non-nullable; TeamsService exposes removal logic that reassigns captain or errors if none available.
- [x] Add Tournament ↔ Team relation (Tournament has many teams; Team has optional tournament). **Success:** Entities compile with FK `tournamentId` and repositories registered.
- [x] Add Match ↔ Team relations for teamA/teamB/winner. **Success:** Match uses Team relations with FKs `teamAId`, `teamBId`, `winnerId`; Team exposes inverse collections.
- [x] Add Tournament ↔ UserRoles relation for join eligibility. **Success:** Tournament lists eligible roles via join table; UserRoles exposes inverse relation; repositories registered.
- [x] Add CRUD (Data Mapper) controllers/services for Player, UserRoles, Team, Match, Tournament with repository-backed methods. **Success:** Basic create/find/update/remove endpoints wired with TypeORM repositories and lint clean.

## Project Status Board

- [x] Executor mode acknowledged (user switched to implementation)
- [x] Step 1: Add Player ↔ UserRoles relation
- [x] Step 2: Wire repositories in modules
- [x] Step 3: Add Team ↔ Player relations (captain/coach/main/reserved)
- [x] Step 4: Enforce captain non-null and auto-promotion logic
- [x] Step 5: Add Tournament ↔ Team relation
- [x] Step 6: Add Match ↔ Team relation (teamA/teamB/winner)
- [x] Step 7: Add Tournament ↔ UserRoles eligibility relation
- [x] Step 8: Add CRUD controllers/services using repositories

## Current Status / Progress Tracking

- **Mode:** Executor (implementation)
- **Recent work:** MEDIA role wired in `role.constants` (names, catalog id, display order, color); migration `1746200000004-AddMediaRoleCatalog` updates DB CHECK + catalog upsert; `findAllCatalog` uses `playerId IS NULL` query builder so all catalog rows are returned; stable sort for list endpoint.

## Executor’s Feedback or Assistance Requests

No blockers. Consider DTO validation/whitelisting for payloads and authorization on CRUD endpoints.

## Lessons

- After adding a `Role` enum value, keep `ROLE_NAMES`, `ROLE_CATALOG_IDS`, `ROLE_CATALOG_DISPLAY_ORDER`, and `ROLE_COLOR_HEX` in sync or `Record<RoleName, string>` fails the build.
- Catalog listing should query `playerId IS NULL` via QueryBuilder; `find` + `relations: ['player']` can interact badly with nullable `ManyToOne` in some cases.
