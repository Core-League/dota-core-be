import { MigrationInterface, QueryRunner } from 'typeorm';

export class TeamActiveCaptainUniqueIndex1780506433642 implements MigrationInterface {
  name = 'TeamActiveCaptainUniqueIndex1780506433642';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team" DROP CONSTRAINT "REL_f71181e2994176fd624db416c2"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_team_active_captain" ON "team" ("captainId") WHERE "disbandedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_team_active_captain"`);
    await queryRunner.query(
      `ALTER TABLE "team" ADD CONSTRAINT "REL_f71181e2994176fd624db416c2" UNIQUE ("captainId")`,
    );
  }
}
