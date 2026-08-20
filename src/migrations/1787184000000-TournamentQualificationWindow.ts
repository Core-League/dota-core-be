import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits the qualification window out of the registration columns.
 *
 * Before this migration the qualification stage had no dates of its own:
 * `Qualification.startTime` was `registrationStartsAt` and `endTime` was
 * `min(registrationEndsAt, tournamentStartsAt)` (the old
 * `QualificationService.qualificationEndBound`). The backfill below reproduces
 * that exact derivation, so every existing tournament keeps the window it
 * already has and no qualification match changes validity on deploy.
 */
export class TournamentQualificationWindow1787184000000 implements MigrationInterface {
  name = 'TournamentQualificationWindow1787184000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "qualificationStartsAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "qualificationEndsAt" TIMESTAMP`,
    );

    await queryRunner.query(`
      UPDATE "tournament"
      SET "qualificationStartsAt" = "registrationStartsAt",
          "qualificationEndsAt" = LEAST("registrationEndsAt", "tournamentStartsAt")
    `);

    await queryRunner.query(
      `ALTER TABLE "tournament" ALTER COLUMN "qualificationStartsAt" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" ALTER COLUMN "qualificationEndsAt" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "qualificationEndsAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "qualificationStartsAt"`,
    );
  }
}
