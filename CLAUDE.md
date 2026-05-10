# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev          # Hot-reload dev server (watch mode)
npm run build              # Compile to dist/
npm run start:prod         # Run compiled app

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

**Module map:**
- `auth/` — JWT (HS256), Discord OAuth, Steam OpenID authentication flows
- `players/` — player profiles, rank system, Steam/Discord linking, verification
- `user-roles/` — role catalog: Guest/Player/Captain/Media/Admin; grant/revoke logic
- `teams/` — team CRUD, captain assignment, invite system, Discord channel IDs
- `tournaments/` — tournament lifecycle, status tracking, points
- `qualification/` — qualification rounds and match records within qualifications
- `matches/` — standalone match records
- `admin/` — admin-only endpoints: player verification, Discord role sync
- `discord/` — Discord bot service for syncing roles/channels with the guild

**DB behaviour by environment:**
- `development`: `synchronize: true`, no migrations on boot
- `staging`/`production`: `synchronize: false`, migrations run on boot

Migrations live in `src/migrations/` (22 files). The TypeORM CLI data source is `src/data-source.ts`.

**Auth flow:**
1. Discord: `GET /auth/discord/url` → OAuth redirect → `POST /auth/discord/token` → JWT
2. Steam: `GET /auth/steam/link` → OpenID redirect → callback stores Steam ID → JWT
3. All protected routes use `JwtAuthGuard`; admin routes add `AdminGuard`

**Environment loading** (`src/config/load-env.ts`): loads `.env`, then overlays `.env.dev` for `development`/`test` (non-empty values only; skipped on staging/production).

**Key env vars:** `NODE_ENV`, `PORT`, `DB_*`, `JWT_SECRET`, `JWT_EXPIRES_SEC`, `DISCORD_*`, `STEAM_*`, `CORS_ORIGINS`.

## Deployment

Push to `dev` branch triggers GitHub Actions: SSH into Ubuntu server → `npm ci` → `npm run build` → `pm2 restart ecosystem.config.js`. PM2 runs the app as `core-backend` with `NODE_ENV=staging`.
