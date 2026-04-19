# dota-core-be

NestJS backend for the Dota platform. PostgreSQL via TypeORM, JWT auth, Discord OAuth, Steam OpenID.

## Setup

```bash
npm install
cp .env.example .env        # fill in secrets
cp .env.example .env.dev    # local overrides (DB, redirect URIs, etc.)
```

`.env.dev` values override `.env` at startup (non-empty values only). Keep secrets in `.env`, local config in `.env.dev`.

## Local development

```bash
npm run db:up       # start Postgres in Docker (data persists in a named volume)
npm run start:dev   # start NestJS in watch mode
```

> **Data loss warning:** `npm run db:down` preserves data. `npm run db:down -- -v` deletes the volume and all data.

Swagger UI is available at `http://localhost:3000/api`.

## Database migrations

`synchronize: true` is active in development — schema changes are applied automatically on startup. In production `synchronize` is off and migrations run automatically on deploy (`migrationsRun: true`).

### Typical workflow

**1. Change an entity** (add a column, change a type, etc.)

**2. Generate a migration** from the diff between entities and the current DB schema:

```bash
npm run migration:generate -- src/migrations/DescribeWhatChanged
```

This creates a timestamped file like `src/migrations/1234567890123-DescribeWhatChanged.ts` with `up()` and `down()` methods. Review it before running.

**3. Apply the migration:**

```bash
npm run migration:run
```

**4. Undo the last migration if something went wrong:**

```bash
npm run migration:revert
```

### Creating a blank migration (for manual SQL / seed data)

```bash
npm run migration:create -- src/migrations/SeedDefaultRoles
```

### Migration scripts reference

| Command | What it does |
|---|---|
| `migration:generate -- src/migrations/<Name>` | Diff entities vs DB, generate migration file |
| `migration:run` | Apply all pending migrations |
| `migration:revert` | Roll back the last applied migration |
| `migration:create -- src/migrations/<Name>` | Create an empty migration file |

### Production

Migrations in `dist/migrations/*.js` run automatically on app startup (`migrationsRun: true`). Make sure you build before deploying:

```bash
npm run build
```

## Auth

| Flow | Endpoints |
|---|---|
| Discord login | `GET /auth/discord/url` → redirect → `POST /auth/discord/token` |
| Steam linking | `GET /auth/steam/link` (JWT required) → redirect → auto callback |
| Steam unlink | `DELETE /auth/steam/link` (JWT required) |
| Steam verify | `POST /auth/steam/verify` (JWT required, needs `STEAM_API_KEY`) |
| Current player | `GET /auth/me` (JWT required) |

## Environment variables

See `.env.example` for all variables and descriptions.
