import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlayoff1746900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "playoff" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tournamentId" uuid NOT NULL,
        "challongeTournamentId" varchar NOT NULL,
        "challongeUrl" varchar NOT NULL,
        "challongeEmbedUrl" varchar NOT NULL,
        CONSTRAINT "PK_playoff" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_playoff_tournamentId" UNIQUE ("tournamentId"),
        CONSTRAINT "FK_playoff_tournament" FOREIGN KEY ("tournamentId")
          REFERENCES "tournament"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "playoff_match" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "playoffId" uuid NOT NULL,
        "teamAId" uuid NOT NULL,
        "teamBId" uuid NOT NULL,
        "winnerId" uuid,
        "dotaMatchId" varchar,
        "challongeMatchId" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_playoff_match" PRIMARY KEY ("id"),
        CONSTRAINT "FK_playoff_match_playoff" FOREIGN KEY ("playoffId")
          REFERENCES "playoff"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_playoff_match_teamA" FOREIGN KEY ("teamAId")
          REFERENCES "team"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_playoff_match_teamB" FOREIGN KEY ("teamBId")
          REFERENCES "team"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_playoff_match_winner" FOREIGN KEY ("winnerId")
          REFERENCES "team"("id") ON DELETE SET NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "playoff_match"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "playoff"`);
  }
}
