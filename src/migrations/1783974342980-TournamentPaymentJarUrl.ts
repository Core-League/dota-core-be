import { MigrationInterface, QueryRunner } from 'typeorm';

export class TournamentPaymentJarUrl1783974342980 implements MigrationInterface {
  name = 'TournamentPaymentJarUrl1783974342980';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "paymentJarUrl" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "paymentJarUrl"`,
    );
  }
}
