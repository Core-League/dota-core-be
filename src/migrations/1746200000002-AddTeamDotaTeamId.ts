import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTeamDotaTeamId1746200000002 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "dotaTeamId" varchar`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team" DROP COLUMN IF EXISTS "dotaTeamId"`,
    );
  }
}
