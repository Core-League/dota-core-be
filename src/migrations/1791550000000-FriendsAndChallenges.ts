import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Friends, friend duel challenges and the notification center.
 *
 * - `friendship`: one row per unordered pair of players (PENDING request or
 *   ACCEPTED friendship); the expression index makes "A→B" and "B→A" the same pair.
 * - `duel_challenge`: "play me a friendly duel" invitations between friends,
 *   accepted ones point at the `duel` they created.
 * - `duel.kind`: `ranked` (matchmaker, ±25) or `friend` (challenge, ±10).
 * - `notification`: per-player inbox rows pushed to the header bell.
 */
export class FriendsAndChallenges1791550000000 implements MigrationInterface {
  name = 'FriendsAndChallenges1791550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "friendship" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "requesterId" uuid NOT NULL,
         "addresseeId" uuid NOT NULL,
         "status" character varying(16) NOT NULL DEFAULT 'PENDING',
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "respondedAt" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_friendship" PRIMARY KEY ("id"),
         CONSTRAINT "FK_friendship_requester" FOREIGN KEY ("requesterId") REFERENCES "player"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_friendship_addressee" FOREIGN KEY ("addresseeId") REFERENCES "player"("id") ON DELETE CASCADE,
         CONSTRAINT "CHK_friendship_not_self" CHECK ("requesterId" <> "addresseeId")
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_friendship_pair"
         ON "friendship" (LEAST("requesterId", "addresseeId"), GREATEST("requesterId", "addresseeId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_friendship_requester" ON "friendship" ("requesterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_friendship_addressee" ON "friendship" ("addresseeId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "kind" character varying(16) NOT NULL DEFAULT 'ranked'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_kind" ON "duel" ("kind")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "duel_challenge" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "challengerId" uuid NOT NULL,
         "challengedId" uuid NOT NULL,
         "status" character varying(16) NOT NULL DEFAULT 'PENDING',
         "duelId" uuid,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
         "respondedAt" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_duel_challenge" PRIMARY KEY ("id"),
         CONSTRAINT "FK_duel_challenge_challenger" FOREIGN KEY ("challengerId") REFERENCES "player"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_duel_challenge_challenged" FOREIGN KEY ("challengedId") REFERENCES "player"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_duel_challenge_duel" FOREIGN KEY ("duelId") REFERENCES "duel"("id") ON DELETE SET NULL
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_challenge_challenger" ON "duel_challenge" ("challengerId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_challenge_challenged" ON "duel_challenge" ("challengedId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_challenge_status" ON "duel_challenge" ("status")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "notification" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "playerId" uuid NOT NULL,
         "type" character varying(32) NOT NULL,
         "status" character varying(16),
         "refId" uuid,
         "payload" jsonb NOT NULL DEFAULT '{}',
         "readAt" TIMESTAMP WITH TIME ZONE,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_notification" PRIMARY KEY ("id"),
         CONSTRAINT "FK_notification_player" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_player_created" ON "notification" ("playerId", "createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_ref" ON "notification" ("refId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notification"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "duel_challenge"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_duel_kind"`);
    await queryRunner.query(`ALTER TABLE "duel" DROP COLUMN IF EXISTS "kind"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "friendship"`);
  }
}
