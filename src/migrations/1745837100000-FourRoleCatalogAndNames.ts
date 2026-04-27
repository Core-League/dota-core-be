import { MigrationInterface, QueryRunner } from 'typeorm';

/** Canonical role-type rows (`playerId` null) + rename old Ukrainian labels. */
export class FourRoleCatalogAndNames1745837100000 implements MigrationInterface {
  name = 'FourRoleCatalogAndNames1745837100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "CHK_user_roles_name_allowed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ALTER COLUMN "playerId" DROP NOT NULL`,
    );

    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'Гравець' WHERE "name" IN ('Користувач', 'user', 'User', 'USER')
    `);
    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'Адмін' WHERE "name" IN ('Адміністратор', 'admin', 'Admin', 'ADMIN')
    `);

    await queryRunner.query(`
      UPDATE "user_roles" ur SET "name" = 'Адмін' WHERE ur."isAdminRole" = true
    `);
    await queryRunner.query(`
      UPDATE "user_roles" ur
      SET "name" = 'Гравець'
      FROM "player" p
      WHERE ur."playerId" = p."id"
        AND ur."isAdminRole" = false
        AND p."verifiedAt" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "user_roles" ur
      SET "name" = 'Гість'
      FROM "player" p
      WHERE ur."playerId" = p."id"
        AND ur."isAdminRole" = false
        AND p."verifiedAt" IS NULL
    `);

    await queryRunner.query(`
      INSERT INTO "user_roles" ("id", "name", "isAdminRole", "playerId") VALUES
        ('38c8837a-99b8-4262-937e-5fe2c58147bd', 'Гість', false, NULL),
        ('1467ac22-bf2c-4e5b-b9aa-487fc51ae49e', 'Гравець', false, NULL),
        ('a30f9d64-2336-4502-beac-f1d6dcb01987', 'Капітан', false, NULL),
        ('5c298c1d-33ce-4465-b2df-5b783c0513f9', 'Адмін', true, NULL)
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name",
        "isAdminRole" = EXCLUDED."isAdminRole",
        "playerId" = COALESCE("user_roles"."playerId", EXCLUDED."playerId")
    `);

    await queryRunner.query(`
      UPDATE "user_roles" SET "name" = 'Гість'
      WHERE "name" NOT IN ('Гість', 'Гравець', 'Капітан', 'Адмін')
    `);

    await queryRunner.query(`
      ALTER TABLE "user_roles" ADD CONSTRAINT "CHK_user_roles_name_allowed" CHECK (
        "name" IN ('Гість', 'Гравець', 'Капітан', 'Адмін')
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "CHK_user_roles_name_allowed"`,
    );
    await queryRunner.query(`
      DELETE FROM "user_roles" WHERE "id" IN (
        '38c8837a-99b8-4262-937e-5fe2c58147bd',
        '1467ac22-bf2c-4e5b-b9aa-487fc51ae49e',
        'a30f9d64-2336-4502-beac-f1d6dcb01987',
        '5c298c1d-33ce-4465-b2df-5b783c0513f9'
      ) AND "playerId" IS NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "user_roles" ALTER COLUMN "playerId" SET NOT NULL`,
    );
  }
}
