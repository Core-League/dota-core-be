import '../connectors/config/load-env';
import { DataSource } from 'typeorm';

/**
 * v2's own TypeORM data source. Unlike v1 (`src/data-source.ts`, which globs
 * `src/**\/*.entity.ts`), this one scopes to v2's finance models (`*.model.ts`)
 * and migrations (`src/db/migrations/`). v1's data source never sees these
 * files, so the two apps own disjoint sets of tables on the shared database.
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
  entities: ['src/db/models/*.model.ts'],
  migrations: ['src/db/migrations/*.ts'],
});
