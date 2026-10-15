import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Streamer channels of a media bracket besides the main stream link
 * (`duel_bracket."streamerLinks"`: Telegram, Kick, YouTube, TikTok, Instagram).
 */
export class DuelBracketStreamerLinks1792400000000 implements MigrationInterface {
  name = 'DuelBracketStreamerLinks1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel_bracket" ADD COLUMN IF NOT EXISTS "streamerLinks" jsonb NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel_bracket" DROP COLUMN IF EXISTS "streamerLinks"`,
    );
  }
}
