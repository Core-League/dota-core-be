import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the optional third-place match flag to the tournament.
 *
 * Additive only: a NOT NULL boolean whose default backfills every existing row
 * as `false` — no bracket created before this change held a third-place match,
 * so no live tournament changes behaviour.
 */
export class TournamentThirdPlaceMatch1790400000000 implements MigrationInterface {
  name = 'TournamentThirdPlaceMatch1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "hasThirdPlaceMatch" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "hasThirdPlaceMatch"`,
    );
  }
}
