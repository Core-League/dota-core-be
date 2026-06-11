import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the FK backing the new `VerificationRequestPlayerModel.player` relation:
 * `verification_request_player.playerId` → v1-owned `player(id)`. v2 still owns
 * only its own table here — the `player` table itself is untouched (mapped
 * read-only via `PlayerModel`, `synchronize: false`).
 */
export class AddVerificationRequestPlayerFk1781200000000 implements MigrationInterface {
  name = 'AddVerificationRequestPlayerFk1781200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_request_player" ADD CONSTRAINT "FK_verification_request_player_player" FOREIGN KEY ("playerId") REFERENCES "player"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_request_player" DROP CONSTRAINT "FK_verification_request_player_player"`,
    );
  }
}
