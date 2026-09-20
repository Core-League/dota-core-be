import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the Monobank acquiring invoice columns.
 *
 * `invoiceId` is the callback's lookup key and `paymentPageUrl` lets a repeat
 * click reuse a live invoice instead of minting one per click. Existing rows get
 * nulls: a payment already PAID needs neither, and a PENDING one gets a fresh
 * invoice on the captain's next visit.
 *
 * Purely additive, so it can deploy ahead of the jar teardown; dropping
 * `tournament.paymentJarUrl` is a separate, destructive migration.
 */
export class TournamentAcquiringInvoice1789800000000 implements MigrationInterface {
  name = 'TournamentAcquiringInvoice1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" ADD "invoiceId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" ADD CONSTRAINT "UQ_tournament_team_payment_invoice" UNIQUE ("invoiceId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" ADD "paymentPageUrl" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" DROP COLUMN "paymentPageUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" DROP CONSTRAINT "UQ_tournament_team_payment_invoice"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" DROP COLUMN "invoiceId"`,
    );
  }
}
