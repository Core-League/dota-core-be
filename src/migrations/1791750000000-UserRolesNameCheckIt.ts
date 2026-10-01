import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `CHK_user_roles_name_allowed` був створений на проді вручну (не міграцією) і не знав ролі «IT» —
 * будь-яке призначення IT падало з 500. Перестворюємо constraint зі списком із `ROLE_NAMES`.
 * NOT VALID: перевіряються лише нові / змінені рядки, тож наявні дані не можуть зламати деплой.
 * Додаєш роль у `role.constants.ts` — додай і сюди нову міграцію.
 */
export class UserRolesNameCheckIt1791750000000 implements MigrationInterface {
  name = 'UserRolesNameCheckIt1791750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "CHK_user_roles_name_allowed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "CHK_user_roles_name_allowed" ` +
        `CHECK ("name" IN ('Гість', 'Гравець', 'Капітан', 'Медіа', 'Адмін', 'IT')) NOT VALID`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "CHK_user_roles_name_allowed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "CHK_user_roles_name_allowed" ` +
        `CHECK ("name" IN ('Гість', 'Гравець', 'Капітан', 'Медіа', 'Адмін')) NOT VALID`,
    );
  }
}
