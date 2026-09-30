import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The game server's SteamID per duel. The GC removes the host bot from the
 * lobby when the server starts, so the match is followed through the
 * server's live scoreboard; a restarted worker needs the id to resume that.
 */
export class DuelServerId1791350000000 implements MigrationInterface {
  name = 'DuelServerId1791350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "serverSteamId" character varying(32)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "serverSteamId"`,
    );
  }
}
