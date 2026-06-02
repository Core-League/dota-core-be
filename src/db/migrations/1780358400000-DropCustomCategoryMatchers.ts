import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropCustomCategoryMatchers1780358400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_category" DROP COLUMN IF EXISTS "matchers"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_category" ADD COLUMN "matchers" jsonb`,
    );
  }
}
