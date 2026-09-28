import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `match_participant` — who actually played each recorded qualification /
 * playoff map, taken from the Dota match data. Written on result submission
 * and backfilled through POST /admin/match-participants/backfill. Source of
 * truth for per-player match statistics.
 */
export class MatchParticipant1791000000000 implements MigrationInterface {
  name = 'MatchParticipant1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "match_participant" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "stage" character varying(16) NOT NULL,
        "matchId" uuid NOT NULL,
        "tournamentId" uuid NOT NULL,
        "dotaMatchId" character varying NOT NULL,
        "playerId" uuid NOT NULL,
        "teamId" uuid,
        "isRadiant" boolean NOT NULL,
        "won" boolean NOT NULL,
        "heroId" integer,
        "kills" smallint,
        "deaths" smallint,
        "assists" smallint,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_match_participant_stage_match_player" UNIQUE ("stage", "matchId", "playerId"),
        CONSTRAINT "PK_match_participant" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_match_participant_player" ON "match_participant" ("playerId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_participant"
        ADD CONSTRAINT "FK_match_participant_player"
        FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_participant"
        ADD CONSTRAINT "FK_match_participant_team"
        FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "match_participant"`);
  }
}
