import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlayerTeamId1746200000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "player"
        ADD COLUMN IF NOT EXISTS "teamId" uuid,
        ADD CONSTRAINT "FK_player_teamId"
          FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "player"
        DROP CONSTRAINT IF EXISTS "FK_player_teamId",
        DROP COLUMN IF EXISTS "teamId"
    `);
  }
}
