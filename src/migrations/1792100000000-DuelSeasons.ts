import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Monthly seasons of the 1v1 ladder.
 *
 * - `duel_season`: Kyiv calendar months, one ACTIVE at a time (partial unique
 *   index), admin-set prize places (jsonb) and when they were settled.
 * - `duel_season_standing`: the frozen final table of an ended season.
 * - `duel."seasonId"`: the season a ranked / friendly duel counts for.
 *
 * Season 1 is October 2026 and keeps the ladder as it is (the lifetime
 * ratings carry into it), so every existing ranked / friendly duel belongs to
 * it. The first reset happens at its end (2026-11-01 00:00 Kyiv).
 */
export class DuelSeasons1792100000000 implements MigrationInterface {
  name = 'DuelSeasons1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "duel_season" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "number" integer NOT NULL,
         "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL,
         "endsAt" TIMESTAMP WITH TIME ZONE NOT NULL,
         "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
         "endedAt" TIMESTAMP WITH TIME ZONE,
         "prizes" jsonb NOT NULL DEFAULT '[]',
         "prizesAwardedAt" TIMESTAMP WITH TIME ZONE,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_duel_season" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_duel_season_number" ON "duel_season" ("number")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_duel_season_active" ON "duel_season" ("status") WHERE "status" = 'ACTIVE'`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "duel_season_standing" (
         "seasonId" uuid NOT NULL,
         "playerId" uuid NOT NULL,
         "position" integer NOT NULL,
         "rating" integer NOT NULL,
         "wins" integer NOT NULL,
         "losses" integer NOT NULL,
         "streak" integer NOT NULL,
         "lastPlayedAt" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_duel_season_standing" PRIMARY KEY ("seasonId", "playerId"),
         CONSTRAINT "FK_duel_season_standing_season" FOREIGN KEY ("seasonId") REFERENCES "duel_season"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_duel_season_standing_player" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_season_standing_player" ON "duel_season_standing" ("playerId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "seasonId" uuid`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_duel_season') THEN
           ALTER TABLE "duel" ADD CONSTRAINT "FK_duel_season"
             FOREIGN KEY ("seasonId") REFERENCES "duel_season"("id") ON DELETE SET NULL;
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duel_season" ON "duel" ("seasonId")`,
    );

    // Season 1 — October 2026 in Kyiv time; skipped when any season exists already.
    await queryRunner.query(
      `INSERT INTO "duel_season" ("number", "startsAt", "endsAt", "status")
       SELECT 1,
              '2026-10-01 00:00:00'::timestamp AT TIME ZONE 'Europe/Kyiv',
              '2026-11-01 00:00:00'::timestamp AT TIME ZONE 'Europe/Kyiv',
              'ACTIVE'
        WHERE NOT EXISTS (SELECT 1 FROM "duel_season")`,
    );
    // Season 1 keeps the lifetime ladder, so the whole ranked / friendly history is its history.
    await queryRunner.query(
      `UPDATE "duel"
          SET "seasonId" = (SELECT "id" FROM "duel_season" WHERE "number" = 1)
        WHERE "seasonId" IS NULL
          AND "kind" IN ('ranked', 'friend')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_duel_season"`);
    await queryRunner.query(
      `ALTER TABLE "duel" DROP CONSTRAINT IF EXISTS "FK_duel_season"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "seasonId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "duel_season_standing"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "duel_season"`);
  }
}
