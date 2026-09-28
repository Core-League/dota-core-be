import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Player profile preferences:
 * - `countryCode` / `city` — where the player is based (ISO 3166-1 alpha-2 +
 *   a city name from the locations catalog, see `LocationsService`).
 * - `wantToPlay` — tournament formats the player is willing to attend
 *   (`ONLINE`, `LAN`); `null` when never set, `{}` when explicitly none —
 *   same convention as `positions`.
 */
export class PlayerLocationAndWantToPlay1790700000000 implements MigrationInterface {
  name = 'PlayerLocationAndWantToPlay1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player" ADD "countryCode" character varying(2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD "city" character varying(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD "wantToPlay" character varying array`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "wantToPlay"`);
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "city"`);
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "countryCode"`);
  }
}
