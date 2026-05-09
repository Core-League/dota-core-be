import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * player.teamId was uuid FK → team.id. Storing Dotabuff/OpenDota team ids (numeric
 * strings) or comparing them in updates causes PostgreSQL "No operator matches"
 * for uuid vs text. Use varchar and drop the FK (reference enforced in app layer).
 */
export class PlayerTeamIdVarchar1746200000003 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "player"
        DROP CONSTRAINT IF EXISTS "FK_player_teamId"
    `);
    await queryRunner.query(`
      ALTER TABLE "player"
        ALTER COLUMN "teamId" TYPE varchar(64)
        USING (CASE WHEN "teamId" IS NULL THEN NULL ELSE "teamId"::text END)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "player"
        ALTER COLUMN "teamId" TYPE uuid
        USING (CASE
          WHEN "teamId" IS NULL OR "teamId" = '' THEN NULL
          WHEN "teamId" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN "teamId"::uuid
          ELSE NULL
        END)
    `);
    await queryRunner.query(`
      ALTER TABLE "player"
        ADD CONSTRAINT "FK_player_teamId"
          FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE SET NULL
    `);
  }
}
