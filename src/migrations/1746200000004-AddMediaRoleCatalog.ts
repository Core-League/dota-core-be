import { MigrationInterface, QueryRunner } from 'typeorm';

const MEDIA_CATALOG_ID = 'b21f4c8a-6d3e-4f1b-9c7a-8e5d2b1f4a6c';

/** Add «Медіа» to allowed names, CHECK constraint, and catalog; re-upsert canonical catalog rows. */
export class AddMediaRoleCatalog1746200000004 implements MigrationInterface {
  name = 'AddMediaRoleCatalog1746200000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "CHK_user_roles_name_allowed"`,
    );

    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'Гість'
      WHERE "name" NOT IN ('Гість', 'Гравець', 'Капітан', 'Адмін', 'Медіа')
    `);

    await queryRunner.query(`
      INSERT INTO "user_roles" ("id", "name", "isAdminRole", "playerId") VALUES
        ('38c8837a-99b8-4262-937e-5fe2c58147bd', 'Гість', false, NULL),
        ('1467ac22-bf2c-4e5b-b9aa-487fc51ae49e', 'Гравець', false, NULL),
        ('a30f9d64-2336-4502-beac-f1d6dcb01987', 'Капітан', false, NULL),
        ('${MEDIA_CATALOG_ID}', 'Медіа', false, NULL),
        ('5c298c1d-33ce-4465-b2df-5b783c0513f9', 'Адмін', true, NULL)
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name",
        "isAdminRole" = EXCLUDED."isAdminRole",
        "playerId" = COALESCE("user_roles"."playerId", EXCLUDED."playerId")
    `);

    await queryRunner.query(`
      ALTER TABLE "user_roles" ADD CONSTRAINT "CHK_user_roles_name_allowed" CHECK (
        "name" IN ('Гість', 'Гравець', 'Капітан', 'Медіа', 'Адмін')
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "CHK_user_roles_name_allowed"`,
    );

    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'Гість', "isAdminRole" = false WHERE "name" = 'Медіа'
    `);

    await queryRunner.query(`
      DELETE FROM "user_roles" WHERE "id" = '${MEDIA_CATALOG_ID}' AND "playerId" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "user_roles" ADD CONSTRAINT "CHK_user_roles_name_allowed" CHECK (
        "name" IN ('Гість', 'Гравець', 'Капітан', 'Адмін')
      )
    `);
  }
}
