import { MigrationInterface, QueryRunner } from 'typeorm';

export class TournamentEntryFeeAndPayments1783971446406 implements MigrationInterface {
  name = 'TournamentEntryFeeAndPayments1783971446406';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tournament" ADD "entryFee" integer`);
    await queryRunner.query(
      `CREATE TYPE "public"."tournament_team_payment_status_enum" AS ENUM('PENDING', 'UNDERPAID', 'PAID')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tournament_team_payment" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"tournamentId" uuid NOT NULL, ` +
        `"teamId" uuid NOT NULL, ` +
        `"reference" character varying NOT NULL, ` +
        `"status" "public"."tournament_team_payment_status_enum" NOT NULL DEFAULT 'PENDING', ` +
        `"amountPaid" integer NOT NULL DEFAULT 0, ` +
        `"transactionId" character varying, ` +
        `"paidAt" TIMESTAMP WITH TIME ZONE, ` +
        `"markedByAdminId" uuid, ` +
        `"note" character varying, ` +
        `"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_tournament_team_payment_reference" UNIQUE ("reference"), ` +
        `CONSTRAINT "UQ_tournament_team_payment_tournament_team" UNIQUE ("tournamentId", "teamId"), ` +
        `CONSTRAINT "PK_tournament_team_payment" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" ADD CONSTRAINT "FK_tournament_team_payment_tournament" ` +
        `FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" ADD CONSTRAINT "FK_tournament_team_payment_team" ` +
        `FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" DROP CONSTRAINT "FK_tournament_team_payment_team"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tournament_team_payment" DROP CONSTRAINT "FK_tournament_team_payment_tournament"`,
    );
    await queryRunner.query(`DROP TABLE "tournament_team_payment"`);
    await queryRunner.query(
      `DROP TYPE "public"."tournament_team_payment_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "tournament" DROP COLUMN "entryFee"`);
  }
}
