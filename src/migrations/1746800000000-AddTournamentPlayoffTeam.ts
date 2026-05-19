import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTournamentPlayoffTeam1746800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tournament_playoff_team (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "tournamentId" UUID NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
        "teamId" UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
        CONSTRAINT uq_tournament_playoff_team UNIQUE ("tournamentId", "teamId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tournament_playoff_team`);
  }
}
