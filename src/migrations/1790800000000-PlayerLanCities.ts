import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `lanCities` — Ukrainian cities a player is willing to travel to for LAN
 * tournaments (paired with `wantToPlay` ∋ LAN). Same null/empty convention as
 * `positions` / `wantToPlay`.
 */
export class PlayerLanCities1790800000000 implements MigrationInterface {
  name = 'PlayerLanCities1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player" ADD "lanCities" character varying array`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "lanCities"`);
  }
}
