import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * VIP status (250 ₴/month through Monobank card tokenization, or granted by an admin).
 * - `player.vipUntil`: VIP lasts while this lies in the future.
 * - `player.vipFrameColor`: card frame colour picked from the VIP palette.
 * - `vip_subscription`: the saved card and the auto-renewal schedule.
 * - `vip_payment`: one row per invoice (first payment / renewal).
 * - `tournament_team_payment.amountDue`: what the open invoice charges — the
 *   entry fee, or 10% less when the paying captain is VIP.
 */
export class VipSubscription1791650000000 implements MigrationInterface {
  name = 'VipSubscription1791650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player" ADD COLUMN IF NOT EXISTS "vipUntil" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD COLUMN IF NOT EXISTS "vipFrameColor" character varying(7)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "vip_subscription" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "playerId" uuid NOT NULL,
        "walletId" character varying(64) NOT NULL,
        "cardToken" character varying,
        "maskedPan" character varying(32),
        "autoRenew" boolean NOT NULL DEFAULT false,
        "nextChargeAt" TIMESTAMP WITH TIME ZONE,
        "failedAttempts" integer NOT NULL DEFAULT 0,
        "renewalClaimedAt" TIMESTAMP WITH TIME ZONE,
        "webHookUrl" character varying,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vip_subscription" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_vip_subscription_player" UNIQUE ("playerId"),
        CONSTRAINT "FK_vip_subscription_player" FOREIGN KEY ("playerId")
          REFERENCES "player"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "vip_payment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "playerId" uuid NOT NULL,
        "reference" character varying(32) NOT NULL,
        "invoiceId" character varying,
        "kind" character varying(16) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'PENDING',
        "amount" integer NOT NULL,
        "pageUrl" character varying,
        "failureReason" character varying,
        "paidAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vip_payment" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_vip_payment_reference" UNIQUE ("reference"),
        CONSTRAINT "UQ_vip_payment_invoice" UNIQUE ("invoiceId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vip_payment_player" ON "vip_payment" ("playerId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" ADD COLUMN IF NOT EXISTS "amountDue" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" DROP COLUMN IF EXISTS "amountDue"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "vip_payment"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vip_subscription"`);
    await queryRunner.query(
      `ALTER TABLE "player" DROP COLUMN IF EXISTS "vipFrameColor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" DROP COLUMN IF EXISTS "vipUntil"`,
    );
  }
}
