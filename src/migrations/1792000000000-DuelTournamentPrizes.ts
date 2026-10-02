import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Prize places of duel tournaments.
 *
 * - `duel_tournament.prizes`: jsonb array of places (VIP months or a custom
 *   image + link), see `DuelTournamentPrize`.
 * - `duel_tournament."prizesAwardedAt"`: when the winners were fixed and VIP
 *   granted. Tournaments that ended before this migration had no prizes, so
 *   they count as settled — the sweep never has to look at them.
 */
export class DuelTournamentPrizes1792000000000 implements MigrationInterface {
  name = 'DuelTournamentPrizes1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel_tournament" ADD COLUMN IF NOT EXISTS "prizes" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel_tournament" ADD COLUMN IF NOT EXISTS "prizesAwardedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `UPDATE "duel_tournament"
          SET "prizesAwardedAt" = COALESCE("endedAt", now())
        WHERE "status" = 'ENDED' AND "prizesAwardedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel_tournament" DROP COLUMN IF EXISTS "prizesAwardedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel_tournament" DROP COLUMN IF EXISTS "prizes"`,
    );
  }
}
