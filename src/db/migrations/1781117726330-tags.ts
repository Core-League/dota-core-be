import { MigrationInterface, QueryRunner } from 'typeorm';

export class Tags1781117726330 implements MigrationInterface {
  name = 'Tags1781117726330';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tag" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "title" character varying NOT NULL, CONSTRAINT "UQ_6a9775008add570dc3e5a0bab7b" UNIQUE ("name"), CONSTRAINT "PK_8e4052373c579afc1471f526760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "player_tag" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "playerId" uuid NOT NULL, "tagId" uuid NOT NULL, CONSTRAINT "UQ_40ef294adf0eca858ab8cb99fea" UNIQUE ("playerId", "tagId"), CONSTRAINT "PK_99619a2b9ffd6a58a3c77a47c87" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_986488b59faf02a465cbafd8de" ON "player_tag" ("playerId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "player_tag" ADD CONSTRAINT "FK_34cb5adc6aa8438c5bb7bf078a0" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player_tag" DROP CONSTRAINT "FK_34cb5adc6aa8438c5bb7bf078a0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_986488b59faf02a465cbafd8de"`,
    );
    await queryRunner.query(`DROP TABLE "player_tag"`);
    await queryRunner.query(`DROP TABLE "tag"`);
  }
}
