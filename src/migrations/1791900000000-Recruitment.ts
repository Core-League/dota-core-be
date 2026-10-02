import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recruitment ("Пошук команди / гравця").
 *
 * - `team_recruitment_post`: a team looking for players; one OPEN post per team.
 * - `player_recruitment_post`: a player looking for a team; one per player.
 * - `team_join_request`: applications (player → team post) and invites
 *   (team → player); one PENDING row per (kind, team, player).
 */
export class Recruitment1791900000000 implements MigrationInterface {
  name = 'Recruitment1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "team_recruitment_post" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "teamId" uuid NOT NULL,
         "authorId" uuid,
         "description" character varying(200),
         "positions" smallint array NOT NULL,
         "playersNeeded" smallint NOT NULL,
         "mmrMin" integer,
         "mmrMax" integer,
         "formats" character varying array NOT NULL DEFAULT '{}',
         "status" character varying(16) NOT NULL DEFAULT 'OPEN',
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "closedAt" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_team_recruitment_post" PRIMARY KEY ("id"),
         CONSTRAINT "FK_team_recruitment_post_team" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_team_recruitment_post_author" FOREIGN KEY ("authorId") REFERENCES "player"("id") ON DELETE SET NULL,
         CONSTRAINT "CHK_team_recruitment_post_mmr" CHECK ("mmrMin" IS NULL OR "mmrMax" IS NULL OR "mmrMin" <= "mmrMax"),
         CONSTRAINT "CHK_team_recruitment_post_needed" CHECK ("playersNeeded" >= 0)
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_team_recruitment_post_open"
         ON "team_recruitment_post" ("teamId") WHERE "status" = 'OPEN'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_recruitment_post_team" ON "team_recruitment_post" ("teamId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_recruitment_post_status" ON "team_recruitment_post" ("status")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "player_recruitment_post" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "playerId" uuid NOT NULL,
         "description" character varying(200),
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_player_recruitment_post" PRIMARY KEY ("id"),
         CONSTRAINT "FK_player_recruitment_post_player" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_player_recruitment_post_player" ON "player_recruitment_post" ("playerId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "team_join_request" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "kind" character varying(16) NOT NULL,
         "teamId" uuid NOT NULL,
         "playerId" uuid NOT NULL,
         "postId" uuid,
         "createdById" uuid,
         "message" character varying(200),
         "position" smallint,
         "slot" character varying(16),
         "status" character varying(16) NOT NULL DEFAULT 'PENDING',
         "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "respondedAt" TIMESTAMP WITH TIME ZONE,
         "respondedById" uuid,
         CONSTRAINT "PK_team_join_request" PRIMARY KEY ("id"),
         CONSTRAINT "FK_team_join_request_team" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_team_join_request_player" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_team_join_request_post" FOREIGN KEY ("postId") REFERENCES "team_recruitment_post"("id") ON DELETE SET NULL,
         CONSTRAINT "FK_team_join_request_created_by" FOREIGN KEY ("createdById") REFERENCES "player"("id") ON DELETE SET NULL
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_team_join_request_pending"
         ON "team_join_request" ("kind", "teamId", "playerId") WHERE "status" = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_join_request_team" ON "team_join_request" ("teamId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_join_request_player" ON "team_join_request" ("playerId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_join_request_status" ON "team_join_request" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_join_request_created_by_created"
         ON "team_join_request" ("createdById", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "team_join_request"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "player_recruitment_post"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "team_recruitment_post"`);
  }
}
