import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Discord voice channel per duel. `number` is the human-readable "Duel #N"
 * (a sequence, so it never repeats even after a ladder purge);
 * `discordVoiceChannelId` is the channel the api-v1 process created once both
 * players accepted, and deletes again after the duel ended.
 */
export class DuelVoiceChannel1791500000000 implements MigrationInterface {
  name = 'DuelVoiceChannel1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SERIAL on ALTER TABLE creates the sequence and numbers the existing rows.
    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "number" SERIAL NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_duel_number" ON "duel" ("number")`,
    );
    await queryRunner.query(
      `ALTER TABLE "duel" ADD COLUMN IF NOT EXISTS "discordVoiceChannelId" character varying(32)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "discordVoiceChannelId"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_duel_number"`);
    await queryRunner.query(
      `ALTER TABLE "duel" DROP COLUMN IF EXISTS "number"`,
    );
  }
}
