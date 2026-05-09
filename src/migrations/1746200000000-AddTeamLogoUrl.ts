import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTeamLogoUrl1746200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "logoUrl" varchar`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team" DROP COLUMN IF EXISTS "logoUrl"`,
    );
  }
}
