import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refunds revoke what they paid for (WayForPay compliance, owner 2026-10-14):
 * entry fees and voluntary support payments get a REFUNDED status, set when
 * the payment provider reports the paid invoice refunded or voided.
 * (`vip_payment.status` is a varchar and needs no change.)
 *
 * PostgreSQL 12+ allows ADD VALUE inside the migration transaction as long as
 * the new value is not used in it, which it is not.
 */
export class PaymentRefunded1792300000000 implements MigrationInterface {
  name = 'PaymentRefunded1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."tournament_team_payment_status_enum" ADD VALUE IF NOT EXISTS 'REFUNDED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."tournament_donation_status_enum" ADD VALUE IF NOT EXISTS 'REFUNDED'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot drop an enum value. REFUNDED stays in both types;
    // the previous code never writes it, so leaving it is harmless.
  }
}
