import { MigrationInterface, QueryRunner } from 'typeorm';

const PLAYER_ID = '392bdc41-f8b0-47d3-8fa6-32f4b824c323';

export class ClearTeamIdForPlayer392bdc411746300000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM team_main_players WHERE "playerId" = '${PLAYER_ID}';
    `);

    await queryRunner.query(`
      DELETE FROM team_reserved_players WHERE "playerId" = '${PLAYER_ID}';
    `);

    await queryRunner.query(`
      UPDATE player SET "teamId" = NULL WHERE id = '${PLAYER_ID}';
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Data fix cannot be reversed automatically
  }
}
