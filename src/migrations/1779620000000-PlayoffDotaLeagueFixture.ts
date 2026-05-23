import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlayoffDotaLeagueFixture1779620000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "playoff"
      ADD COLUMN IF NOT EXISTS "dotaPlayoffContainingNodeGroupId" varchar
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "playoff_league_fixture" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "playoffId" uuid NOT NULL,
        "challongeMatchId" varchar NOT NULL,
        "dotaFixtureNodeGroupId" varchar NOT NULL,
        CONSTRAINT "PK_playoff_league_fixture" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_playoff_league_fixture_playoff_match" UNIQUE ("playoffId", "challongeMatchId"),
        CONSTRAINT "FK_playoff_league_fixture_playoff" FOREIGN KEY ("playoffId")
          REFERENCES "playoff"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "playoff_league_fixture"`);
    await queryRunner.query(`
      ALTER TABLE "playoff" DROP COLUMN IF EXISTS "dotaPlayoffContainingNodeGroupId"
    `);
  }
}
