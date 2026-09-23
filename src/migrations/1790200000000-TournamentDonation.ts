import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `tournament_donation`: one row per donation intent towards a tournament,
 * settled through the same Monobank acquiring callback as entry fees.
 *
 * No natural key on purpose — every click is a new donation — so the only
 * uniqueness is on `reference` (the `DON-` code Monobank echoes back) and on
 * `invoiceId`. `status` gets its own enum type rather than reusing
 * `tournament_team_payment_status_enum`, matching what TypeORM's synchronize
 * would create for the entity in development; the value set is identical.
 *
 * Purely additive: `tournament_team_payment` is untouched.
 */
export class TournamentDonation1790200000000 implements MigrationInterface {
  name = 'TournamentDonation1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."tournament_donation_status_enum" AS ENUM('PENDING', 'UNDERPAID', 'PAID')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tournament_donation" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"tournamentId" uuid NOT NULL, ` +
        `"reference" character varying NOT NULL, ` +
        `"amount" integer NOT NULL, ` +
        `"amountPaid" integer NOT NULL DEFAULT 0, ` +
        `"status" "public"."tournament_donation_status_enum" NOT NULL DEFAULT 'PENDING', ` +
        `"invoiceId" character varying, ` +
        `"paymentPageUrl" character varying, ` +
        `"donorPlayerId" uuid, ` +
        `"paidAt" TIMESTAMP WITH TIME ZONE, ` +
        `"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_tournament_donation_reference" UNIQUE ("reference"), ` +
        `CONSTRAINT "UQ_tournament_donation_invoice" UNIQUE ("invoiceId"), ` +
        `CONSTRAINT "PK_tournament_donation" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tournament_donation_tournament" ON "tournament_donation" ("tournamentId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_donation" ADD CONSTRAINT "FK_tournament_donation_tournament" ` +
        `FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament_donation" DROP CONSTRAINT "FK_tournament_donation_tournament"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tournament_donation_tournament"`,
    );
    await queryRunner.query(`DROP TABLE "tournament_donation"`);
    await queryRunner.query(
      `DROP TYPE "public"."tournament_donation_status_enum"`,
    );
  }
}
