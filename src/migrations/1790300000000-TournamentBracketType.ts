import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the playoff bracket format to the tournament.
 *
 * Additive only: a new enum type and a NOT NULL column whose default backfills
 * every existing row as DOUBLE_ELIMINATION — the only format the playoff engine
 * knew before this change — so no live tournament changes behaviour.
 */
export class TournamentBracketType1790300000000 implements MigrationInterface {
  name = 'TournamentBracketType1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."tournament_brackettype_enum" AS ENUM('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION')`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "bracketType" "public"."tournament_brackettype_enum" NOT NULL DEFAULT 'DOUBLE_ELIMINATION'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "bracketType"`,
    );
    await queryRunner.query(`DROP TYPE "public"."tournament_brackettype_enum"`);
  }
}
