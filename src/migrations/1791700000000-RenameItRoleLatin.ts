import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Роль «ІТ» (кирилиця) → «IT» (латиниця): назва в `user_roles.name` тепер латинська.
 */
export class RenameItRoleLatin1791700000000 implements MigrationInterface {
  name = 'RenameItRoleLatin1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "user_roles" SET "name" = 'IT' WHERE "name" = 'ІТ'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "user_roles" SET "name" = 'ІТ' WHERE "name" = 'IT'`,
    );
  }
}
