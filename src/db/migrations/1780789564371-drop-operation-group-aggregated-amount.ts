import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropOperationGroupAggregatedAmount1780789564371 implements MigrationInterface {
  name = 'DropOperationGroupAggregatedAmount1780789564371';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operation_group" DROP COLUMN "aggregatedAmount"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operation_group" ADD COLUMN "aggregatedAmount" bigint NOT NULL DEFAULT 0`,
    );
  }
}
