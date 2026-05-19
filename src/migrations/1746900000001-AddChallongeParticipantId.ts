import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChallongeParticipantId1746900000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tournament_playoff_team"
      ADD COLUMN "challongeParticipantId" varchar,
      ADD COLUMN "isDisqualified" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tournament_playoff_team"
      DROP COLUMN IF EXISTS "challongeParticipantId",
      DROP COLUMN IF EXISTS "isDisqualified"
    `);
  }
}
