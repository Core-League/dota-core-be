import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WayForPay replaces Monobank acquiring (owner 2026-10-14).
 * - `vip_subscription.provider`: who renews it — every existing row is Monobank.
 * - `vip_subscription.regularRef`: order reference of the paid first month; it
 *   names the WayForPay regular payment in regularApi.
 * - `vip_subscription.lastChargeAt`: the newest WayForPay monthly charge credited.
 * - `vip_subscription.discountPercent`: loyalty discount on every future month
 *   (10% for players who had paid through Monobank).
 * - `vip_subscription.paymentSwitchedAt`: when the switch cancelled its
 *   Monobank auto-renewal.
 * - `player.vipPaymentNoticeSeenAt`: the "payment method changed" pop-up was read.
 */
export class WayForPayVip1792200000000 implements MigrationInterface {
  name = 'WayForPayVip1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vip_subscription" ADD COLUMN IF NOT EXISTS "provider" character varying(16) NOT NULL DEFAULT 'mono'`,
    );
    await queryRunner.query(
      `ALTER TABLE "vip_subscription" ADD COLUMN IF NOT EXISTS "regularRef" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "vip_subscription" ADD COLUMN IF NOT EXISTS "lastChargeAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "vip_subscription" ADD COLUMN IF NOT EXISTS "discountPercent" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "vip_subscription" ADD COLUMN IF NOT EXISTS "paymentSwitchedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vip_subscription_regular_ref" ON "vip_subscription" ("regularRef")`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD COLUMN IF NOT EXISTS "vipPaymentNoticeSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player" DROP COLUMN IF EXISTS "vipPaymentNoticeSeenAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_vip_subscription_regular_ref"`,
    );
    for (const column of [
      'paymentSwitchedAt',
      'discountPercent',
      'lastChargeAt',
      'regularRef',
      'provider',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "vip_subscription" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
