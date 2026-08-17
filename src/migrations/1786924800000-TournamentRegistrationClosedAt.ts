import { MigrationInterface, QueryRunner } from 'typeorm';

export class TournamentRegistrationClosedAt1786924800000 implements MigrationInterface {
  name = 'TournamentRegistrationClosedAt1786924800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "registrationClosedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "registrationClosedAt"`,
    );
  }
}
