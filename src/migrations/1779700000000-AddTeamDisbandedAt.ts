import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTeamDisbandedAt1779700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "disbandedAt" TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "team" DROP COLUMN IF EXISTS "disbandedAt"
    `);
  }
}
