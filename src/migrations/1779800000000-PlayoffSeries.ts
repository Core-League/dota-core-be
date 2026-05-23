import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlayoffSeries1779800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "playoff_series" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "playoffId" uuid NOT NULL,
        "challongeMatchId" varchar NOT NULL,
        "bestOf" smallint NOT NULL DEFAULT 1,
        "isFinalsBo3" boolean NOT NULL DEFAULT false,
        "teamAId" uuid,
        "teamBId" uuid,
        "seriesWinnerId" uuid,
        "resolvedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_playoff_series" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_playoff_series_playoff_challonge" UNIQUE ("playoffId", "challongeMatchId"),
        CONSTRAINT "FK_playoff_series_playoff" FOREIGN KEY ("playoffId")
          REFERENCES "playoff" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_playoff_series_teamA" FOREIGN KEY ("teamAId")
          REFERENCES "team" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_playoff_series_teamB" FOREIGN KEY ("teamBId")
          REFERENCES "team" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_playoff_series_winner" FOREIGN KEY ("seriesWinnerId")
          REFERENCES "team" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "playoff_match"
      ADD COLUMN "seriesId" uuid,
      ADD COLUMN "gameNumber" smallint
    `);

    await queryRunner.query(`
      INSERT INTO "playoff_series" ("id", "playoffId", "challongeMatchId", "bestOf", "isFinalsBo3")
      SELECT gen_random_uuid(), "g"."playoffId", "g"."challongeMatchId",
        CASE
          WHEN "g"."gameCount" > 1 THEN 3::smallint
          ELSE 1::smallint
        END AS "bestOf",
        false AS "isFinalsBo3"
      FROM (
        SELECT "playoffId", "challongeMatchId", COUNT(*)::int AS "gameCount"
        FROM "playoff_match"
        GROUP BY "playoffId", "challongeMatchId"
      ) AS "g"
    `);

    await queryRunner.query(`
      UPDATE "playoff_match" AS "pm"
      SET "seriesId" = "sub"."seriesId",
          "gameNumber" = "sub"."rn"
      FROM (
        SELECT
          "pm2"."id",
          "ps"."id" AS "seriesId",
          ROW_NUMBER() OVER (
            PARTITION BY "pm2"."playoffId", "pm2"."challongeMatchId"
            ORDER BY "pm2"."createdAt" ASC
          ) AS "rn"
        FROM "playoff_match" AS "pm2"
        INNER JOIN "playoff_series" AS "ps"
          ON "ps"."playoffId" = "pm2"."playoffId"
          AND "ps"."challongeMatchId" = "pm2"."challongeMatchId"
      ) AS "sub"
      WHERE "pm"."id" = "sub"."id"
    `);

    await queryRunner.query(`
      UPDATE "playoff_series" AS "ps"
      SET "teamAId" = "snap"."teamAId",
          "teamBId" = "snap"."teamBId",
          "seriesWinnerId" = "snap"."seriesWinnerId",
          "resolvedAt" = CASE
            WHEN "snap"."seriesWinnerId" IS NOT NULL THEN "snap"."lastAt"
            ELSE NULL
          END
      FROM (
        SELECT DISTINCT ON ("seriesId")
          "seriesId",
          "teamAId",
          "teamBId",
          "winnerId" AS "seriesWinnerId",
          "createdAt" AS "lastAt"
        FROM "playoff_match"
        WHERE "seriesId" IS NOT NULL AND "winnerId" IS NOT NULL
        ORDER BY "seriesId", "createdAt" DESC
      ) AS "snap"
      WHERE "ps"."id" = "snap"."seriesId"
        AND "ps"."bestOf" = 1
    `);

    await queryRunner.query(`
      ALTER TABLE "playoff_match"
      ADD CONSTRAINT "FK_playoff_match_series" FOREIGN KEY ("seriesId")
        REFERENCES "playoff_series"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "playoff_match" DROP CONSTRAINT "FK_playoff_match_series"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" DROP COLUMN "seriesId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playoff_match" DROP COLUMN "gameNumber"`,
    );
    await queryRunner.query(`DROP TABLE "playoff_series"`);
  }
}
