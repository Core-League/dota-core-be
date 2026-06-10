import { MigrationInterface, QueryRunner } from 'typeorm';

/** Seeds the default moderation tag: marks players noticed for suspicious behavior. */
export class TagsSeed1781117740156 implements MigrationInterface {
  name = 'TagsSeed1781117740156';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "tag" ("name", "title") VALUES ('suspicious-behavior', 'Підозріла поведінка') ON CONFLICT ("name") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "tag" WHERE "name" = 'suspicious-behavior'`,
    );
  }
}
