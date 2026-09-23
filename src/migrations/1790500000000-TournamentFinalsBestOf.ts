import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the per-slot finals series length to the tournament: upper-bracket
 * final, lower-bracket final and grand final, each 1 (BO1) or 3 (BO3).
 *
 * Additive only: three NOT NULL smallint columns whose default backfills every
 * existing row as 3 — every finals slot was BO3 before this change — so no
 * live tournament changes behaviour.
 */
export class TournamentFinalsBestOf1790500000000 implements MigrationInterface {
  name = 'TournamentFinalsBestOf1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "upperBracketFinalBestOf" smallint NOT NULL DEFAULT 3`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "lowerBracketFinalBestOf" smallint NOT NULL DEFAULT 3`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "grandFinalBestOf" smallint NOT NULL DEFAULT 3`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "grandFinalBestOf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "lowerBracketFinalBestOf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "upperBracketFinalBestOf"`,
    );
  }
}
