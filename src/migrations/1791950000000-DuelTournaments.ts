import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Password-protected 1v1 tournaments (media staff / admins).
 *
 * - `duel_tournament`: name, join password, ACTIVE / ENDED.
 * - `duel_tournament_participant`: who entered the password + their line on
 *   the tournament's own leaderboard (same numbers as `duel_rating`).
 * - `duel."tournamentId"`: tournament duels (kind `tournament`).
 * - `duel_queue."tournamentId"`: which queue a player waits in (null = ladder).
 */
export class DuelTournaments1791950000000 implements MigrationInterface {
  name = 'DuelTournaments1791950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "duel_tournament" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "name" character varying(64) NOT NULL,
         "password" character varying(32) NOT NULL,
         "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
         "createdById" uuid,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "endedAt" TIMESTAMP WITH TIME ZONE,
         "endedById" uuid,
         CONSTRAINT "PK_duel_tournament" PRIMARY KEY ("id"),
         CONSTRAINT "FK_duel_tournament_created_by" FOREIGN KEY ("createdById") REFERENCES "player"("id") ON DELETE SET NULL
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_tournament_status" ON "duel_tournament" ("status")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "duel_tournament_participant" (
         "tournamentId" uuid NOT NULL,
         "playerId" uuid NOT NULL,
         "rating" integer NOT NULL DEFAULT 0,
         "wins" integer NOT NULL DEFAULT 0,
         "losses" integer NOT NULL DEFAULT 0,
         "streak" integer NOT NULL DEFAULT 0,
         "lastPlayedAt" TIMESTAMP WITH TIME ZONE,
         "joinedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_duel_tournament_participant" PRIMARY KEY ("tournamentId", "playerId"),
         CONSTRAINT "FK_duel_tournament_participant_tournament" FOREIGN KEY ("tournamentId") REFERENCES "duel_tournament"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_duel_tournament_participant_player" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_tournament_participant_player" ON "duel_tournament_participant" ("playerId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "tournamentId" uuid`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_duel_tournament') THEN
           ALTER TABLE "duel" ADD CONSTRAINT "FK_duel_tournament"
             FOREIGN KEY ("tournamentId") REFERENCES "duel_tournament"("id") ON DELETE SET NULL;
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_tournament" ON "duel" ("tournamentId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "duel_queue" ADD COLUMN IF NOT EXISTS "tournamentId" uuid`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_duel_queue_tournament') THEN
           ALTER TABLE "duel_queue" ADD CONSTRAINT "FK_duel_queue_tournament"
             FOREIGN KEY ("tournamentId") REFERENCES "duel_tournament"("id") ON DELETE CASCADE;
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_queue_tournament" ON "duel_queue" ("tournamentId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_duel_queue_tournament"`);
    await queryRunner.query(
      `ALTER TABLE "duel_queue" DROP CONSTRAINT IF EXISTS "FK_duel_queue_tournament"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel_queue" DROP COLUMN IF EXISTS "tournamentId"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_duel_tournament"`);
    await queryRunner.query(
      `ALTER TABLE "duel" DROP CONSTRAINT IF EXISTS "FK_duel_tournament"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "tournamentId"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "duel_tournament_participant"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "duel_tournament"`);
  }
}
