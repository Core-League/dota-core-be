import '../connectors/config/load-env';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

/**
 * v2's own TypeORM data source. Unlike v1 (`src/data-source.ts`, which globs
 * all `*.entity.{ts,js}`), this one scopes to v2's finance models (`*.model.*`)
 * and migrations (`src/db/migrations/`). v1's data source never sees these
 * files, so the two apps own disjoint sets of tables on the shared database.
 *
 * Globs are `__dirname`-relative with a `{ts,js}` suffix so this works both
 * under ts-node (dev, `__dirname=src/db` → `*.ts`) and compiled (prod,
 * `__dirname=dist/db` → `*.js`).
 *
 * Used only by the TypeORM CLI (migration:*:v2 scripts); the running app
 * configures its own connection in `db.module.ts`.
 */
export const V2DataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  entities: [join(__dirname, 'models/*.model.{ts,js}')],
  migrations: [join(__dirname, 'migrations/*.{ts,js}')],
});
