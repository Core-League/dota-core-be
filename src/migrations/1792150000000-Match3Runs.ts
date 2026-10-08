import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Match-3 mini-game on the duels page: one row per run. The leaderboard is
 * each player's best FINISHED run, hence the partial index on score.
 */
export class Match3Runs1792150000000 implements MigrationInterface {
  name = 'Match3Runs1792150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "match3_run" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "playerId" uuid NOT NULL,
         "seed" integer NOT NULL,
         "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
         "score" integer NOT NULL DEFAULT 0,
         "moves" integer NOT NULL DEFAULT 0,
         "bestChain" integer NOT NULL DEFAULT 0,
         "actions" integer NOT NULL DEFAULT 0,
         "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "finishedAt" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_match3_run" PRIMARY KEY ("id"),
         CONSTRAINT "FK_match3_run_player" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_match3_run_player" ON "match3_run" ("playerId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_match3_run_finished_score" ON "match3_run" ("score" DESC) WHERE "status" = 'FINISHED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "match3_run"`);
  }
}
