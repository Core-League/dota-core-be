import { MigrationInterface, QueryRunner } from 'typeorm';

const PLAYER_ID = '82576aa2-d457-4e01-8fdb-de00df80257a';

export class GrantAdminToUser82576aa21779408000000 implements MigrationInterface {
  name = 'GrantAdminToUser82576aa21779408000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      UPDATE "user_roles"
      SET "name" = 'Адмін', "isAdminRole" = true
      WHERE "playerId" = $1
        AND "isAdminRole" = false
      `,
      [PLAYER_ID],
    );
    await queryRunner.query(
      `
      INSERT INTO "user_roles" ("id", "name", "isAdminRole", "playerId")
      SELECT gen_random_uuid(), 'Адмін', true, $1::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM "user_roles" WHERE "playerId" = $1::uuid
      )
      `,
      [PLAYER_ID],
    );
  }

  public async down(): Promise<void> {
    await Promise.resolve();
  }
}
