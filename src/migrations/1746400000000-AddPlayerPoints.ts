import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlayerPoints1746400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove the transient player.points column if it was added by an earlier version
    await queryRunner.query(
      `ALTER TABLE player DROP COLUMN IF EXISTS "points";`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS player_tournament_points (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "playerId" uuid NOT NULL,
        "tournamentId" uuid NOT NULL,
        points integer NOT NULL DEFAULT 0,
        CONSTRAINT fk_ptp_player FOREIGN KEY ("playerId") REFERENCES player(id) ON DELETE CASCADE,
        CONSTRAINT fk_ptp_tournament FOREIGN KEY ("tournamentId") REFERENCES tournament(id) ON DELETE CASCADE,
        CONSTRAINT uq_ptp_player_tournament UNIQUE ("playerId", "tournamentId")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS player_tournament_points;`);
  }
}
