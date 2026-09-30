import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Player-requested lobby restarts ("a player failed to load").
 * - `restartRequests`: player id → ISO time of the latest request, written by
 *   api-v1 (`POST /duels/:id/restart`) and served by the bot-worker on its tick.
 * - `gameState`: the Dota `game_state` last seen on the live scoreboard while
 *   the duel is LIVE, so the API and the site can tell whether the pick phase
 *   has begun (a restart is refused from then on).
 */
export class DuelRestartRequests1791600000000 implements MigrationInterface {
  name = 'DuelRestartRequests1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "restartRequests" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "gameState" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "gameState"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "restartRequests"`,
    );
  }
}
