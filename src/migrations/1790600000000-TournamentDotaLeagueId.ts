import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the Dota 2 league from the `DOTA_LEAGUE_ID` env var onto the tournament:
 * `dotaLeagueId` names the league in which the qualification stage, playoff
 * shell and every fixture node are created.
 *
 * Every existing row is backfilled with 19183 — the single league every
 * tournament lived in while the value was global — so no live tournament
 * changes league. The default is dropped straight after the backfill: new
 * tournaments must name their league explicitly (`CreateTournamentDto`).
 */
export class TournamentDotaLeagueId1790600000000 implements MigrationInterface {
  name = 'TournamentDotaLeagueId1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "dotaLeagueId" integer NOT NULL DEFAULT 19183`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament" ALTER COLUMN "dotaLeagueId" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "dotaLeagueId"`,
    );
  }
}
