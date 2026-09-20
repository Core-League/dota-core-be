import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retires the Monobank jar rail's last column.
 *
 * Irreversible in substance: `down()` restores the column but not the links it
 * held. Accepted deliberately — the jar rail is retired, not paused. Run it only
 * once the acquiring rail is confirmed working in the target environment.
 */
export class DropTournamentPaymentJarUrl1789800100000 implements MigrationInterface {
  name = 'DropTournamentPaymentJarUrl1789800100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" DROP COLUMN "paymentJarUrl"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament" ADD "paymentJarUrl" character varying`,
    );
  }
}
