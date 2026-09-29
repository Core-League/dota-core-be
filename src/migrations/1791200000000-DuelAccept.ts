import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Accept step + player cancels for the 1v1 ladder: a paired duel now waits in
 * ACCEPTING until both players press Accept (30 s); players may cancel their
 * own duel before the game starts (−10); each player gets a random hero drawn
 * at pairing time. Adds the columns that carry that.
 */
export class DuelAccept1791200000000 implements MigrationInterface {
  name = 'DuelAccept1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel"
         ADD COLUMN "acceptDeadlineAt" TIMESTAMP WITH TIME ZONE,
         ADD COLUMN "acceptedPlayerIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
         ADD COLUMN "cancelledById" uuid,
         ADD COLUMN "heroes" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel"
         DROP COLUMN "heroes",
         DROP COLUMN "cancelledById",
         DROP COLUMN "acceptedPlayerIds",
         DROP COLUMN "acceptDeadlineAt"`,
    );
  }
}
