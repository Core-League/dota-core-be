import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the FK backing the new `PlayerTagModel.player` relation:
 * `player_tag.playerId` → v1-owned `player(id)`. v2 still owns only its own
 * join table here — the `player` table itself is untouched (mapped read-only
 * via `PlayerModel`, `synchronize: false`).
 */
export class AddPlayerTagFk1781200100000 implements MigrationInterface {
  name = 'AddPlayerTagFk1781200100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player_tag" ADD CONSTRAINT "FK_player_tag_player" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player_tag" DROP CONSTRAINT "FK_player_tag_player"`,
    );
  }
}
