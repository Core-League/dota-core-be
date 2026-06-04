# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development — two apps, two entry points, one build (see Architecture)
npm run start:dev          # v1 hot-reload dev server (port 3000)
npm run start:dev:v2       # v2 hot-reload dev server (port 3002)
npm run build              # Compile ALL of src/ to dist/ (emits both entry points)
npm run start:prod         # Run compiled v1  (dist/entry-points/http/api-v1/main)
npm run start:prod:v2      # Run compiled v2  (dist/entry-points/http/api-v2/main)

# Testing
npm run test               # Jest unit tests
npm run test:watch         # Jest watch mode
npm run test:e2e           # End-to-end tests
npm run test:cov           # Coverage report

# Linting & Formatting
npm run lint               # ESLint with auto-fix
npm run format             # Prettier format

# Database (Docker)
npm run db:up              # Start local Postgres container
npm run db:down            # Stop container (preserves volume)
npm run db:down:clean      # Stop + delete volume

# Migrations
npm run migration:generate -- src/migrations/MigrationName   # Diff entities → migration
npm run migration:run      # Apply pending migrations
npm run migration:revert   # Rollback last migration
npm run migration:create -- src/migrations/MigrationName     # Blank migration
```

## Architecture

NestJS 11 REST API with TypeORM 0.3 + PostgreSQL 16. Swagger docs auto-generated at `/api`.

This repo hosts **two apps in one `src/` tree**, compiled by a single `npm run build` into one `dist/`, run as **two separate processes** against the **same database**. A reverse proxy routes the v2 subdomain to the v2 process.

- **v1** (`entry-points/http/api-v1/main.ts` → `app.module.ts`, port 3000) — the original **feature-per-folder** app. Holds all current domains. Uses class-validator `ValidationPipe`.
- **v2** (`entry-points/http/api-v2/main.ts` → `http-api.module.ts`, port 3002) — the **clean/hexagonal layered** app. Currently an **empty scaffold**: foundation only, no domains yet. Uses `ZodValidationPipe`.

Each process bootstraps its own root module, so only its own entities/pipes load — no collision on the shared DB.

**v1 layout (feature-per-folder):**
- `auth/` — JWT (HS256), Discord OAuth, Steam OpenID authentication flows
- `players/` — player profiles, rank system, Steam/Discord linking, verification
- `user-roles/` — role catalog: Guest/Player/Captain/Media/Admin; grant/revoke logic
- `teams/` — team CRUD, captain assignment, invite system, Discord channel IDs
- `tournaments/` — tournament lifecycle, status tracking, points
- `qualification/` — qualification rounds and match records within qualifications
- `matches/` — standalone match records
- `admin/` — admin-only endpoints: player verification, Discord role sync
- `discord/` — Discord bot service for syncing roles/channels with the guild

**v2 layout (layered — populated as domains migrate):**
- `entry-points/http/api-v2/` — bootstrap + `HttpApiModule` (root)
- `connectors/` — external integrations & config (`connectors/config` = Zod-validated env via `ConfigConnectorService`)
- `controllers/` — HTTP boundary (`controllers/common` = health + logging interceptor); one `<domain>-controller/` per domain
- `use-cases/` — business logic, one `<domain>/` folder each (placeholder for now)
- `repos/` — data access (`ReposModule`, currently empty)
- `db/` — `db.module.ts` (TypeORM client) + `models/` (entity models, `index.ts` `entities` list, empty) + `mappers/`
- `types/` — Zod domain entities, DTOs, enums

**Schema ownership — v1 owns it.** v1 runs all migrations and (in dev) synchronize over the single `src/migrations/` + `src/data-source.ts`. v2's `DbModule` is a **non-owning client**: `synchronize:false`, `migrationsRun:false`, with an empty `entities` list until domains move over.
- v1 DB behaviour: `development` → `synchronize: true`, no migrations on boot; `staging`/`production` → `synchronize: false`, migrations run on boot.

**Migrating a domain v1 → v2** (one at a time): add its `db/models/<d>.model.ts` (+ to `models/index.ts` `entities`), `repos/<d>.repository.ts` (+ to `repos.module`), `use-cases/<d>/**`, `controllers/<d>-controller/**`; wire the controller module into `HttpApiModule`; then delete the v1 feature folder + unwire from `AppModule` and shift the proxy route. Once v2 owns enough of the schema, hand migration ownership to it.

**Auth flow:**
1. Discord: `GET /auth/discord/url` → OAuth redirect → `POST /auth/discord/token` → JWT
2. Steam: `GET /auth/steam/link` → OpenID redirect → callback stores Steam ID → JWT
3. All protected routes use `JwtAuthGuard`; admin routes add `AdminGuard`

**Environment loading**: loads `.env`, then overlays `.env.dev` for `development`/`test` (non-empty values only; skipped on staging/production). v1 loads it via `src/config/load-env.ts`; v2 via `src/connectors/config/load-env.ts` — both read the same root `.env*` files.

**Key env vars:** `NODE_ENV`, `PORT`, `DB_*`, `JWT_SECRET`, `JWT_EXPIRES_SEC`, `DISCORD_*`, `STEAM_*`, `CORS_ORIGINS`.

## Deployment

**Docker Compose on a self-hosted runner.** One workflow `.github/workflows/deploy.yml` triggers on push to `main` (→ Environment `production`) and `dev` (→ Environment `staging`); the branch selects the Environment, project name, and image name via expressions. The job runs on `runs-on: self-hosted`, checks out the repo, sets all GitHub secrets + vars inline, then `docker compose up -d --build`.

Two Dockerfiles back three services in `docker-compose.yml`, all on `network_mode: host`:
- `migrate` — `Dockerfile.migrate` (dev deps + src, no build); one-shot, runs `migration:run` + `migration:run:v2` via ts-node, then exits.
- `api-v1` — `Dockerfile` (prod-only deps + `dist`, no dev deps/src); binds `${API_V1_PORT}` directly on the host.
- `api-v2` — `Dockerfile`; binds `${API_V2_PORT}` directly on the host.

`api-v1`/`api-v2` `depends_on` `migrate` with `service_completed_successfully`, so migrations always finish before the apps start. Staging uses `COMPOSE_PROJECT_NAME=dota-core-be-staging` for an isolated stack on the same host. Under host networking there is no port mapping — the listen port *is* the host port — so staging and prod must use different `API_V1_PORT`/`API_V2_PORT` (e.g. prod 3000/3010, staging 3001/3011).

**Config (no `.env` file):** each service's `environment:` lists value-less names; Compose forwards them from the shell that runs `docker compose`. The deploy step sets each value inline before the command (`NAME="${{ vars.NAME }}"` / `NAME="${{ secrets.NAME }}"` … `docker compose --env-file /dev/null up`), so GitHub is the only config source (the committed root `.env` is ignored). Each app's `PORT` is set via `command` from `${API_V1_PORT}`/`${API_V2_PORT}`; `IMAGE_TAG` and project/image names come from job `env`. Adding a new app env var means three edits: the GitHub Environment, the inline list in the workflow, and the `environment:` names in `docker-compose.yml`.

**DB is external (not containerized).** With `network_mode: host` the containers share the host's network namespace, so `DB_HOST=127.0.0.1` reaches a host-local Postgres with no Postgres/firewall changes. A remote `DB_HOST` IP works as-is.

Required GitHub Environment config (production + staging): every app secret/var (`DB_*`, `JWT_SECRET`, `DISCORD_*`, etc.) as Environment **secrets/vars** referenced inline in the workflow, plus `API_V1_PORT` / `API_V2_PORT` vars. Runner needs Docker. `ecosystem.config.js` (PM2) is superseded by this flow.

Local equivalent (load an env file into the shell yourself, no auto-forward): `set -a; . ./.env.staging; set +a; API_V1_PORT=3000 API_V2_PORT=3010 docker compose up -d --build`.

**Test coverage**:
- DO NOT WRITE OR RUN TESTS
