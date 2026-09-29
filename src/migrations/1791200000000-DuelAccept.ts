import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Accept step + player cancels for the 1v1 ladder: a paired duel now waits in
 * ACCEPTING until both players press Accept (30 s); players may cancel their
 * own duel before the game starts (−10). Adds the columns that carry that.
 * (The `heroes` column is in DuelHeroes1791250000000: this migration was
 * already applied on production when heroes were added.)
 */
export class DuelAccept1791200000000 implements MigrationInterface {
  name = 'DuelAccept1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel"
         ADD COLUMN "acceptDeadlineAt" TIMESTAMP WITH TIME ZONE,
         ADD COLUMN "acceptedPlayerIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
         ADD COLUMN "cancelledById" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel"
         DROP COLUMN "cancelledById",
         DROP COLUMN "acceptedPlayerIds",
         DROP COLUMN "acceptDeadlineAt"`,
    );
  }
}
