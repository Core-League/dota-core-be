import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Site chat.
 *
 * - `chat_message`: messages of every channel; `participantIds` holds the
 *   owners of private channels (admin thread owner / both DM players) and is
 *   GIN-indexed for "my private threads" lookups.
 * - `chat_read_marker`: per player and channel, the moment read up to — the
 *   source of unread badges.
 *
 * `chat_message.createdAt` keeps millisecond precision (JS `Date`): clients
 * echo it back as the read marker and history cursor, and a microsecond
 * remainder would leave the last message "unread" forever.
 */
export class Chat1791800000000 implements MigrationInterface {
  name = 'Chat1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "chat_message" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "channelKey" character varying(96) NOT NULL,
         "channelKind" character varying(16) NOT NULL,
         "authorId" uuid NOT NULL,
         "body" text NOT NULL,
         "participantIds" uuid[] NOT NULL DEFAULT '{}',
         "mentionedPlayerIds" uuid[] NOT NULL DEFAULT '{}',
         "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
         "deletedAt" TIMESTAMP WITH TIME ZONE,
         "deletedById" uuid,
         CONSTRAINT "PK_chat_message" PRIMARY KEY ("id"),
         CONSTRAINT "FK_chat_message_author" FOREIGN KEY ("authorId") REFERENCES "player"("id") ON DELETE CASCADE,
         CONSTRAINT "CHK_chat_message_kind" CHECK ("channelKind" IN ('general', 'captains', 'duel', 'admin', 'dm'))
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_message_channel_created" ON "chat_message" ("channelKey", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_message_kind_created" ON "chat_message" ("channelKind", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_message_participants" ON "chat_message" USING GIN ("participantIds")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "chat_read_marker" (
         "playerId" uuid NOT NULL,
         "channelKey" character varying(96) NOT NULL,
         "lastReadAt" TIMESTAMP WITH TIME ZONE NOT NULL,
         CONSTRAINT "PK_chat_read_marker" PRIMARY KEY ("playerId", "channelKey"),
         CONSTRAINT "FK_chat_read_marker_player" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_read_marker"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_message"`);
  }
}
