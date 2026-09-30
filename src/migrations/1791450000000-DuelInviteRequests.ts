import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Invite me again" requests per duel (player id → ISO time of the latest
 * request). Written by api-v1 (`POST /duels/:id/invite`), read by the
 * bot-worker on its tick, which re-sends the Dota 2 lobby invite.
 */
export class DuelInviteRequests1791450000000 implements MigrationInterface {
  name = 'DuelInviteRequests1791450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "inviteRequests" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "inviteRequests"`,
    );
  }
}
