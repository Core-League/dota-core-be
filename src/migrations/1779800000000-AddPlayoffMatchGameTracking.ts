import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlayoffMatchGameTracking1779800000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "playoff_match"
      ADD COLUMN IF NOT EXISTS "gameNumber" int NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "isVerified" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      UPDATE "playoff_match" pm
      SET "gameNumber" = sub.rn
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY "challongeMatchId"
                 ORDER BY "createdAt" ASC
               ) AS rn
        FROM "playoff_match"
      ) sub
      WHERE pm.id = sub.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "playoff_match"
      DROP COLUMN IF EXISTS "gameNumber",
      DROP COLUMN IF EXISTS "isVerified"
    `);
  }
}
