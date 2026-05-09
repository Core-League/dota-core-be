import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTeamDiscordFields1746700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE team
        ADD COLUMN IF NOT EXISTS "discordRoleId" VARCHAR NULL,
        ADD COLUMN IF NOT EXISTS "discordChannelId" VARCHAR NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE team
        DROP COLUMN IF EXISTS "discordRoleId",
        DROP COLUMN IF EXISTS "discordChannelId";
    `);
  }
}
