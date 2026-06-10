import { MigrationInterface, QueryRunner } from 'typeorm';

export class Verification1781049861942 implements MigrationInterface {
  name = 'Verification1781049861942';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "verification_slot" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "endsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."verification_slot_status_enum" NOT NULL DEFAULT 'free', CONSTRAINT "PK_73c426ab152865aa74fdfa528cb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90f9199e965ca2300d71290a28" ON "verification_slot" ("startsAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "verification_request_player" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "requestId" uuid NOT NULL, "playerId" uuid NOT NULL, "resultMmr" integer, CONSTRAINT "PK_2132ef076a91c4c5e9129e65dea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_13162b8b16192a3355067433c2" ON "verification_request_player" ("requestId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "verification_request" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "teamId" uuid NOT NULL, "slotId" uuid NOT NULL, "type" "public"."verification_request_type_enum" NOT NULL, "status" "public"."verification_request_status_enum" NOT NULL DEFAULT 'pending', "createdByPlayerId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_c22023263c44fc480798e0cd883" UNIQUE ("slotId"), CONSTRAINT "REL_c22023263c44fc480798e0cd88" UNIQUE ("slotId"), CONSTRAINT "PK_9d9499e0fabae343c7ec3ecfac9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_821ebd832dd8b1333ee69289d4" ON "verification_request" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_request_player" ADD CONSTRAINT "FK_13162b8b16192a3355067433c29" FOREIGN KEY ("requestId") REFERENCES "verification_request"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_request" ADD CONSTRAINT "FK_c22023263c44fc480798e0cd883" FOREIGN KEY ("slotId") REFERENCES "verification_slot"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_request" DROP CONSTRAINT "FK_c22023263c44fc480798e0cd883"`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_request_player" DROP CONSTRAINT "FK_13162b8b16192a3355067433c29"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_821ebd832dd8b1333ee69289d4"`,
    );
    await queryRunner.query(`DROP TABLE "verification_request"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_13162b8b16192a3355067433c2"`,
    );
    await queryRunner.query(`DROP TABLE "verification_request_player"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90f9199e965ca2300d71290a28"`,
    );
    await queryRunner.query(`DROP TABLE "verification_slot"`);
  }
}
