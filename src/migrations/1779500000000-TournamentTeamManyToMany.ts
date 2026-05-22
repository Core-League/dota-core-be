import { MigrationInterface, QueryRunner } from 'typeorm';

export class TournamentTeamManyToMany1779500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tournament_team" (
        "tournamentId" uuid NOT NULL,
        "teamId" uuid NOT NULL,
        CONSTRAINT "PK_tournament_team" PRIMARY KEY ("tournamentId", "teamId"),
        CONSTRAINT "FK_tournament_team_tournament" FOREIGN KEY ("tournamentId")
          REFERENCES "tournament"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tournament_team_team" FOREIGN KEY ("teamId")
          REFERENCES "team"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      INSERT INTO "tournament_team" ("tournamentId", "teamId")
      SELECT "tournamentId", "id"
      FROM "team"
      WHERE "tournamentId" IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "team" DROP COLUMN IF EXISTS "tournamentId"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team" ADD COLUMN "tournamentId" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "team"
        ADD CONSTRAINT "FK_team_tournament"
        FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE SET NULL
    `);

    // Restore FK for teams in exactly one tournament
    await queryRunner.query(`
      UPDATE "team" t
      SET "tournamentId" = tt."tournamentId"
      FROM "tournament_team" tt
      WHERE t."id" = tt."teamId"
    `);

    await queryRunner.query(`DROP TABLE "tournament_team"`);
  }
}
