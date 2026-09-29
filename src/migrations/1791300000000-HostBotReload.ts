import { MigrationInterface, QueryRunner } from 'typeorm';

/** Manual bot restart from the admin panel: a timestamp the worker compares with each bot's start. */
export class HostBotReload1791300000000 implements MigrationInterface {
  name = 'HostBotReload1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "host_bot" ADD COLUMN "reloadRequestedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "host_bot" DROP COLUMN "reloadRequestedAt"`,
    );
  }
}
