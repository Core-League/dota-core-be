import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes the qualification stage optional per tournament.
 *
 * `hasQualification` defaults to true, so every existing tournament keeps the
 * stage it already has and its dates stay populated — this migration changes no
 * existing row's behaviour. Only tournaments created afterwards with the flag
 * off carry null qualification dates.
 */
export class TournamentOptionalQualification1789776100000 implements MigrationInterface {
  name = 'TournamentOptionalQualification1789776100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "hasQualification" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" ALTER COLUMN "qualificationStartsAt" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" ALTER COLUMN "qualificationEndsAt" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /**
     * Restoring NOT NULL needs every row to carry dates again. Tournaments
     * created without a qualification stage have none, so they are given the
     * same derivation `TournamentQualificationWindow1787184000000` used when it
     * first backfilled the columns.
     */
    await queryRunner.query(`
      UPDATE "tournament"
      SET "qualificationStartsAt" = COALESCE("qualificationStartsAt", "registrationStartsAt"),
          "qualificationEndsAt" = COALESCE(
            "qualificationEndsAt",
            LEAST("registrationEndsAt", "tournamentStartsAt")
          )
      WHERE "qualificationStartsAt" IS NULL
         OR "qualificationEndsAt" IS NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "tournament" ALTER COLUMN "qualificationEndsAt" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" ALTER COLUMN "qualificationStartsAt" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "hasQualification"`,
    );
  }
}
