import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optional stream link of a duel tournament (`duel_tournament."streamUrl"`),
 * set by the organiser on create / update.
 */
export class DuelTournamentStreamUrl1792050000000 implements MigrationInterface {
  name = 'DuelTournamentStreamUrl1792050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel_tournament" ADD COLUMN IF NOT EXISTS "streamUrl" character varying(512) DEFAULT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel_tournament" DROP COLUMN IF EXISTS "streamUrl"`,
    );
  }
}
