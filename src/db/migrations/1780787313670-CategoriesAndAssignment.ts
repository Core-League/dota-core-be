import { MigrationInterface, QueryRunner } from 'typeorm';

export class CategoriesAndAssignment1780787313670 implements MigrationInterface {
  name = 'CategoriesAndAssignment1780787313670';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."custom_category_sign_enum" AS ENUM('INCOME', 'EXPENSE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "custom_category" ADD "sign" "public"."custom_category_sign_enum" NOT NULL DEFAULT 'EXPENSE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "custom_category" ADD "matchers" text array NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(`ALTER TABLE "operation" ADD "categoryId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "operation" ADD "categoryManual" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_54d44174fb89e86a63f2f226cd" ON "operation" ("categoryId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "operation" ADD CONSTRAINT "FK_54d44174fb89e86a63f2f226cdf" FOREIGN KEY ("categoryId") REFERENCES "custom_category"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operation" DROP CONSTRAINT "FK_54d44174fb89e86a63f2f226cdf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_54d44174fb89e86a63f2f226cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "operation" DROP COLUMN "categoryManual"`,
    );
    await queryRunner.query(`ALTER TABLE "operation" DROP COLUMN "categoryId"`);
    await queryRunner.query(
      `ALTER TABLE "custom_category" DROP COLUMN "matchers"`,
    );
    await queryRunner.query(`ALTER TABLE "custom_category" DROP COLUMN "sign"`);
    await queryRunner.query(`DROP TYPE "public"."custom_category_sign_enum"`);
  }
}
