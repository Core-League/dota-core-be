import { MigrationInterface, QueryRunner } from 'typeorm';

const TEAM_ID = '7a9c7583-6c17-49f8-87d3-b7c6d0d65558';

/** Data fix: varchar `player.teamId` has no FK ON DELETE; clear stale refs to removed team. */
export class ClearPlayerTeamId7a9c75831746200000005 implements MigrationInterface {
  name = 'ClearPlayerTeamId7a9c75831746200000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "player" SET "teamId" = NULL WHERE "teamId" = $1`,
      [TEAM_ID],
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    await Promise.resolve();
  }
}
