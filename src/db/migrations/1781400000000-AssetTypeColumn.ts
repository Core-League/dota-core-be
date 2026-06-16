import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a `type` classification column to `asset` (what the asset depicts:
 * team / player / finance-category icon / MMR proof). Existing rows default to
 * `UNKNOWN`. Drives nothing in storage/URL resolution — it's a catalog tag.
 */
export class AssetTypeColumn1781400000000 implements MigrationInterface {
  name = 'AssetTypeColumn1781400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."asset_type_enum" AS ENUM('UNKNOWN', 'TEAM', 'PLAYER', 'FIN_CATEGORY', 'PROOF')`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset" ADD "type" "public"."asset_type_enum" NOT NULL DEFAULT 'UNKNOWN'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "type"`);
    await queryRunner.query(`DROP TYPE "public"."asset_type_enum"`);
  }
}
