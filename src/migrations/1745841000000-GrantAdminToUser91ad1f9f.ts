import { MigrationInterface, QueryRunner } from 'typeorm';

const PLAYER_ID = '91ad1f9f-c360-4cc0-b39e-81d64443e9a6';

/**
 * One-off: grant admin for a specific user (prod). Idempotent.
 * 1) Promote any non-admin `user_roles` row for this player to Адмін.
 * 2) If the player has no `user_roles` at all, insert an admin row.
 */
export class GrantAdminToUser91ad1f9f1745841000000 implements MigrationInterface {
  name = 'GrantAdminToUser91ad1f9f1745841000000';

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
