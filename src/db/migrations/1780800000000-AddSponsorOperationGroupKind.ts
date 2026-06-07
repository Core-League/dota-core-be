import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSponsorOperationGroupKind1780800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "operation_group_kind_enum" ADD VALUE IF NOT EXISTS 'SPONSOR'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres does not support removing enum values directly.
    // Recreate the enum without SPONSOR and migrate any existing rows.
    await queryRunner.query(`
      UPDATE "operation_group" SET "kind" = 'CUSTOM' WHERE "kind" = 'SPONSOR'
    `);
    await queryRunner.query(`
      ALTER TYPE "operation_group_kind_enum" RENAME TO "operation_group_kind_enum_old"
    `);
    await queryRunner.query(`
      CREATE TYPE "operation_group_kind_enum" AS ENUM('PRIZE', 'CUSTOM')
    `);
    await queryRunner.query(`
      ALTER TABLE "operation_group"
        ALTER COLUMN "kind" TYPE "operation_group_kind_enum"
        USING "kind"::text::"operation_group_kind_enum"
    `);
    await queryRunner.query(`DROP TYPE "operation_group_kind_enum_old"`);
  }
}
