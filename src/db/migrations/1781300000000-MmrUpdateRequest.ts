import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the v2-owned `mmr_update_request` table and its `mmr_update_request_proof`
 * join table. A request is a verified player's MMR-change request; `playerId` is
 * unique (one request per player) and FK-references the v1-owned `player(id)`.
 * Proof screenshots are stored as `asset` rows linked through the join table
 * (composite PK `(requestId, assetId)`, ordered by `ordinal`); both of its FKs
 * cascade-delete. v2 owns the two new tables; the `player` table is untouched.
 */
export class MmrUpdateRequest1781300000000 implements MigrationInterface {
  name = 'MmrUpdateRequest1781300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."mmr_update_request_status_enum" AS ENUM('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "mmr_update_request" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "playerId" uuid NOT NULL, "oldMmr" integer NOT NULL, "newMmr" integer NOT NULL, "status" "public"."mmr_update_request_status_enum" NOT NULL DEFAULT 'pending', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_mmr_update_request_player" UNIQUE ("playerId"), CONSTRAINT "PK_mmr_update_request" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "mmr_update_request_proof" ("requestId" uuid NOT NULL, "assetId" uuid NOT NULL, "ordinal" integer NOT NULL, CONSTRAINT "PK_mmr_update_request_proof" PRIMARY KEY ("requestId", "assetId"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "mmr_update_request" ADD CONSTRAINT "FK_mmr_update_request_player" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mmr_update_request_proof" ADD CONSTRAINT "FK_mmr_update_request_proof_request" FOREIGN KEY ("requestId") REFERENCES "mmr_update_request"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mmr_update_request_proof" ADD CONSTRAINT "FK_mmr_update_request_proof_asset" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mmr_update_request_proof" DROP CONSTRAINT "FK_mmr_update_request_proof_asset"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mmr_update_request_proof" DROP CONSTRAINT "FK_mmr_update_request_proof_request"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mmr_update_request" DROP CONSTRAINT "FK_mmr_update_request_player"`,
    );
    await queryRunner.query(`DROP TABLE "mmr_update_request_proof"`);
    await queryRunner.query(`DROP TABLE "mmr_update_request"`);
    await queryRunner.query(
      `DROP TYPE "public"."mmr_update_request_status_enum"`,
    );
  }
}
