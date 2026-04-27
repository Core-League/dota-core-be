import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameRolesToUkrainian1745837000000 implements MigrationInterface {
  name = 'RenameRolesToUkrainian1745837000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'Гість' WHERE "name" IN ('guest', 'Guest', 'GUEST')
    `);
    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'Користувач' WHERE "name" IN ('user', 'User', 'USER')
    `);
    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'Адміністратор' WHERE "name" IN ('admin', 'Admin', 'ADMIN')
    `);
    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'Гість'
      WHERE "name" NOT IN ('Гість', 'Користувач', 'Адміністратор')
    `);
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "CHK_user_roles_name_allowed"`,
    );
    await queryRunner.query(`
      ALTER TABLE "user_roles" ADD CONSTRAINT "CHK_user_roles_name_allowed" CHECK (
        "name" IN ('Гість', 'Користувач', 'Адміністратор')
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "CHK_user_roles_name_allowed"`,
    );
    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'guest' WHERE "name" = 'Гість'
    `);
    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'user' WHERE "name" = 'Користувач'
    `);
    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'admin' WHERE "name" = 'Адміністратор'
    `);
  }
}
