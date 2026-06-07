import '../connectors/config/load-env';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

/**
 * v2's TypeORM data source, used only by the CLI (migration:*:v2); the app
 * connects via `db.module.ts`. Scoped to v2's finance models (`*.model.*`) +
 * migrations, disjoint from v1's tables on the shared DB. Globs are
 * `__dirname`-relative with `{ts,js}` so they work under ts-node (dev) and
 * compiled (prod).
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
