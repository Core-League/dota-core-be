import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checkout consent log (WayForPay compliance, owner 2026-10-14).
 *
 * `payment_consent`: one row per newly minted payment page (entry fee,
 * voluntary support, VIP), written in the same transaction as the payment row:
 * who agreed (null for a guest), to which legal-documents version, for which
 * product, reference and amount. Append-only: a trigger refuses UPDATE and
 * DELETE. No foreign keys on purpose — the proof outlives a deleted account
 * or tournament. Snake-case columns as agreed in the compliance contract.
 */
export class PaymentConsent1792250000000 implements MigrationInterface {
  name = 'PaymentConsent1792250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_consent" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "player_id" uuid,
        "legal_version" character varying(32) NOT NULL,
        "product" character varying(16) NOT NULL,
        "reference" character varying(64) NOT NULL,
        "amount_kopecks" integer NOT NULL,
        "currency" character varying(3) NOT NULL,
        "provider" character varying(16) NOT NULL,
        CONSTRAINT "PK_payment_consent" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_consent_reference" ON "payment_consent" ("reference")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_consent_player" ON "payment_consent" ("player_id")`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "payment_consent_append_only"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'payment_consent is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_payment_consent_append_only" ON "payment_consent"`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "TRG_payment_consent_append_only" BEFORE UPDATE OR DELETE ON "payment_consent" ` +
        `FOR EACH ROW EXECUTE FUNCTION "payment_consent_append_only"()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_consent"`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "payment_consent_append_only"()`,
    );
  }
}
