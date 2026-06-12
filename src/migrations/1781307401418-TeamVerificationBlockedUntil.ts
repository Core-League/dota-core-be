import { MigrationInterface, QueryRunner } from 'typeorm';

export class TeamVerificationBlockedUntil1781307401418 implements MigrationInterface {
  name = 'TeamVerificationBlockedUntil1781307401418';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team" ADD "verificationBlockedUntil" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team" DROP COLUMN "verificationBlockedUntil"`,
    );
  }
}
