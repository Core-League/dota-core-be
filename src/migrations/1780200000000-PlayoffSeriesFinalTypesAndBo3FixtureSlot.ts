import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlayoffSeriesFinalTypesAndBo3FixtureSlot1780200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "playoff_series"
      RENAME COLUMN "isFinalsBo3" TO "isFinalSeries"
    `);
    await queryRunner.query(`
      ALTER TABLE "playoff_series"
      ADD COLUMN IF NOT EXISTS "finalType" varchar NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "playoff_league_fixture"
      DROP CONSTRAINT IF EXISTS "UQ_playoff_league_fixture_playoff_match"
    `);

    await queryRunner.query(`
      ALTER TABLE "playoff_league_fixture"
      ADD COLUMN IF NOT EXISTS "fixtureSlot" smallint NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_playoff_league_fixture_slot"
      ON "playoff_league_fixture" ("playoffId", "challongeMatchId", "fixtureSlot")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_playoff_league_fixture_slot"
    `);

    await queryRunner.query(`
      ALTER TABLE "playoff_league_fixture"
      DROP COLUMN IF EXISTS "fixtureSlot"
    `);

    await queryRunner.query(`
      ALTER TABLE "playoff_league_fixture"
      ADD CONSTRAINT "UQ_playoff_league_fixture_playoff_match"
      UNIQUE ("playoffId", "challongeMatchId")
    `);

    await queryRunner.query(`
      ALTER TABLE "playoff_series" DROP COLUMN IF EXISTS "finalType"
    `);
    await queryRunner.query(`
      ALTER TABLE "playoff_series"
      RENAME COLUMN "isFinalSeries" TO "isFinalsBo3"
    `);
  }
}
