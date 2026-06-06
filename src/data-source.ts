import './config/load-env';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

// __dirname-relative + {ts,js} globs so the same data source works under
// ts-node (dev, __dirname=src → *.ts) and compiled (prod, __dirname=dist → *.js).
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  entities: [join(__dirname, '**/*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations/*.{ts,js}')],
});
