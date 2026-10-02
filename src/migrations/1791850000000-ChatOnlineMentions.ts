import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `@online` in public chat channels: the players tagged by it (everyone
 * connected to the channel at send time) are kept apart from explicit
 * `@nick` mentions, so a message card does not carry hundreds of player
 * cards while unread mention counters still see every tagged player.
 */
export class ChatOnlineMentions1791850000000 implements MigrationInterface {
  name = 'ChatOnlineMentions1791850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "onlineMentionIds" uuid[] NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_message" DROP COLUMN IF EXISTS "onlineMentionIds"`,
    );
  }
}
