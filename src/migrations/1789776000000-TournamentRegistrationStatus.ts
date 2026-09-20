import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds REGISTRATION as the first tournament lifecycle status.
 *
 * Postgres cannot `ALTER TYPE ... ADD VALUE` inside the transaction TypeORM
 * wraps migrations in, so the enum is swapped the long way: rename the old
 * type, create the new one, recast the column through text, drop the old type.
 * The column has no default, so there is none to drop and restore.
 *
 * Deliberately no data backfill. A team may join in REGISTRATION *or*
 * QUALIFICATIONS (see `isJoinableStatus`), so existing tournaments keep
 * accepting entries exactly as before and nothing has to move. Moving them
 * would also be futile: `TournamentQualificationWindow1787184000000` backfilled
 * legacy rows with `qualificationStartsAt = registrationStartsAt`, so that date
 * is already in the past for all of them and `TournamentQualificationScheduler`
 * would put them straight back into QUALIFICATIONS on its next tick.
 */
export class TournamentRegistrationStatus1789776000000 implements MigrationInterface {
  name = 'TournamentRegistrationStatus1789776000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."tournament_tournamentstatus_enum" RENAME TO "tournament_tournamentstatus_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tournament_tournamentstatus_enum" AS ENUM('REGISTRATION', 'QUALIFICATIONS', 'PLAYOFF', 'COMPLETED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" ALTER COLUMN "tournamentStatus" TYPE "public"."tournament_tournamentstatus_enum" USING "tournamentStatus"::"text"::"public"."tournament_tournamentstatus_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."tournament_tournamentstatus_enum_old"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fold the new status back before it stops being representable.
    await queryRunner.query(`
      UPDATE "tournament"
      SET "tournamentStatus" = 'QUALIFICATIONS'
      WHERE "tournamentStatus" = 'REGISTRATION'
    `);

    await queryRunner.query(
      `ALTER TYPE "public"."tournament_tournamentstatus_enum" RENAME TO "tournament_tournamentstatus_enum_new"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tournament_tournamentstatus_enum" AS ENUM('QUALIFICATIONS', 'PLAYOFF', 'COMPLETED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" ALTER COLUMN "tournamentStatus" TYPE "public"."tournament_tournamentstatus_enum" USING "tournamentStatus"::"text"::"public"."tournament_tournamentstatus_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."tournament_tournamentstatus_enum_new"`,
    );
  }
}
