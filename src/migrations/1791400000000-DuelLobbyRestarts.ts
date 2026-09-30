import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Relaunch counter per duel. A launched game that never starts (a player
 * failed to load, the server aborted the match) gets its lobby restarted by
 * the host bot; after `DUEL_MAX_LOBBY_RESTARTS` the duel is cancelled instead.
 */
export class DuelLobbyRestarts1791400000000 implements MigrationInterface {
  name = 'DuelLobbyRestarts1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "lobbyRestarts" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "lobbyRestarts"`,
    );
  }
}
