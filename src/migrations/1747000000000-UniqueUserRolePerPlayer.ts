import { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueUserRolePerPlayer1747000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove duplicate (playerId, name) rows — keep the one with the lowest id
    await queryRunner.query(`
      DELETE FROM "user_roles"
      WHERE "playerId" IS NOT NULL
        AND id NOT IN (
          SELECT DISTINCT ON ("playerId", name) id
          FROM "user_roles"
          WHERE "playerId" IS NOT NULL
          ORDER BY "playerId", name, id
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "user_roles"
      ADD CONSTRAINT "UQ_user_roles_player_name" UNIQUE ("playerId", name)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_roles"
      DROP CONSTRAINT "UQ_user_roles_player_name"
    `);
  }
}
