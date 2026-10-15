import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Host bots log in with a saved Steam refresh token instead of the password
 * (password logons are what Steam throttles — `AccountLoginDeniedThrottle`),
 * and remember a throttle cooldown so restarts/deploys don't hammer Steam.
 */
export class HostBotLoginSession1792450000000 implements MigrationInterface {
  name = 'HostBotLoginSession1792450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "host_bot" ADD COLUMN "refreshTokenEnc" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "host_bot" ADD COLUMN "loginCooldownUntil" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "host_bot" DROP COLUMN "loginCooldownUntil"`,
    );
    await queryRunner.query(
      `ALTER TABLE "host_bot" DROP COLUMN "refreshTokenEnc"`,
    );
  }
}
