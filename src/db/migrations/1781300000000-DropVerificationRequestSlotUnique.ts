import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A verification slot can be booked, cancelled by an admin, then re-booked — each
 * booking is its own `verification_request` row. The original schema put a UNIQUE
 * constraint on `slotId` (plus the `REL_` unique from the old one-to-one), which
 * made the second booking collide and surface as a 500. Drop both uniques and
 * replace them with a plain lookup index; uniqueness of a *live* request per slot
 * is enforced in code via the slot's `free` status, not in the schema.
 *
 * The FK `slotId` → `verification_slot(id)` is left intact.
 */
export class DropVerificationRequestSlotUnique1781300000000 implements MigrationInterface {
  name = 'DropVerificationRequestSlotUnique1781300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_request" DROP CONSTRAINT "UQ_c22023263c44fc480798e0cd883"`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_request" DROP CONSTRAINT "REL_c22023263c44fc480798e0cd88"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_request_slotId" ON "verification_request" ("slotId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_verification_request_slotId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_request" ADD CONSTRAINT "REL_c22023263c44fc480798e0cd88" UNIQUE ("slotId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_request" ADD CONSTRAINT "UQ_c22023263c44fc480798e0cd883" UNIQUE ("slotId")`,
    );
  }
}
