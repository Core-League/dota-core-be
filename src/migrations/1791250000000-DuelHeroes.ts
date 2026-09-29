import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Random hero per player, drawn at pairing time (`duel.heroes`).
 *
 * Lives in its own migration because `DuelAccept1791200000000` had already
 * been applied on production before the column was added to it; a migration
 * that already ran never runs again, so the column has to come from here.
 * `IF NOT EXISTS` keeps it safe for databases that got the column earlier.
 */
export class DuelHeroes1791250000000 implements MigrationInterface {
  name = 'DuelHeroes1791250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "heroes" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "heroes"`,
    );
  }
}
