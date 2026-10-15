import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Single-elimination 1v1 media tournaments (streamers / admins).
 *
 * - `duel_bracket`: the tournament (registration → live → finished/cancelled),
 *   optional password, size cap, stream link, prize places.
 * - `duel_bracket_participant`: registered players, their seed and final place.
 * - `duel_bracket_match`: bracket nodes (round, position, both slots, winner)
 *   and the duel currently played for each.
 * - `duel."bracketMatchId"`: bracket duels (kind `bracket`).
 * - `duel."spectators"`: accounts the host bot invites without a game slot.
 */
export class DuelBrackets1792350000000 implements MigrationInterface {
  name = 'DuelBrackets1792350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "duel_bracket" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "name" character varying(64) NOT NULL,
         "description" text DEFAULT NULL,
         "password" character varying(32) DEFAULT NULL,
         "status" character varying(16) NOT NULL DEFAULT 'REGISTRATION',
         "maxParticipants" integer NOT NULL,
         "scheduledAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL,
         "streamUrl" character varying(512) DEFAULT NULL,
         "prizes" jsonb NOT NULL DEFAULT '[]',
         "seeding" character varying(16) DEFAULT NULL,
         "rounds" integer NOT NULL DEFAULT 0,
         "winnerId" uuid DEFAULT NULL,
         "createdById" uuid,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "startedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL,
         "finishedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL,
         "prizesAwardedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL,
         CONSTRAINT "PK_duel_bracket" PRIMARY KEY ("id"),
         CONSTRAINT "FK_duel_bracket_created_by" FOREIGN KEY ("createdById") REFERENCES "player"("id") ON DELETE SET NULL
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_bracket_status" ON "duel_bracket" ("status")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "duel_bracket_participant" (
         "bracketId" uuid NOT NULL,
         "playerId" uuid NOT NULL,
         "seed" integer DEFAULT NULL,
         "place" integer DEFAULT NULL,
         "joinedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_duel_bracket_participant" PRIMARY KEY ("bracketId", "playerId"),
         CONSTRAINT "FK_duel_bracket_participant_bracket" FOREIGN KEY ("bracketId") REFERENCES "duel_bracket"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_duel_bracket_participant_player" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_bracket_participant_player" ON "duel_bracket_participant" ("playerId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "duel_bracket_match" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "bracketId" uuid NOT NULL,
         "round" integer NOT NULL,
         "position" integer NOT NULL,
         "isThirdPlace" boolean NOT NULL DEFAULT false,
         "player1Id" uuid DEFAULT NULL,
         "player2Id" uuid DEFAULT NULL,
         "seed1" integer DEFAULT NULL,
         "seed2" integer DEFAULT NULL,
         "status" character varying(16) NOT NULL DEFAULT 'WAITING',
         "winnerId" uuid DEFAULT NULL,
         "loserId" uuid DEFAULT NULL,
         "result" character varying(16) DEFAULT NULL,
         "duelId" uuid DEFAULT NULL,
         "duelsCreated" integer NOT NULL DEFAULT 0,
         "techRetries" integer NOT NULL DEFAULT 0,
         "note" character varying(160) DEFAULT NULL,
         "finishedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL,
         "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_duel_bracket_match" PRIMARY KEY ("id"),
         CONSTRAINT "FK_duel_bracket_match_bracket" FOREIGN KEY ("bracketId") REFERENCES "duel_bracket"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_duel_bracket_match_player1" FOREIGN KEY ("player1Id") REFERENCES "player"("id") ON DELETE SET NULL,
         CONSTRAINT "FK_duel_bracket_match_player2" FOREIGN KEY ("player2Id") REFERENCES "player"("id") ON DELETE SET NULL
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_duel_bracket_match_slot" ON "duel_bracket_match" ("bracketId", "round", "position")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_bracket_match_bracket" ON "duel_bracket_match" ("bracketId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_bracket_match_duel" ON "duel_bracket_match" ("duelId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "bracketMatchId" uuid`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_duel_bracket_match') THEN
           ALTER TABLE "duel" ADD CONSTRAINT "FK_duel_bracket_match"
             FOREIGN KEY ("bracketMatchId") REFERENCES "duel_bracket_match"("id") ON DELETE SET NULL;
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_bracket_match" ON "duel" ("bracketMatchId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "spectators" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "spectators"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_duel_bracket_match"`);
    await queryRunner.query(
      `ALTER TABLE "duel" DROP CONSTRAINT IF EXISTS "FK_duel_bracket_match"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "bracketMatchId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "duel_bracket_match"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "duel_bracket_participant"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "duel_bracket"`);
  }
}
