import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDivisionAndQualification1746300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE SEQUENCE IF NOT EXISTS dota_node_group_seq
      START WITH 82 INCREMENT BY 1 NO CYCLE
    `);

    await queryRunner.query(`
      CREATE TYPE tournament_division_enum AS ENUM (
        'DIVISION_I',
        'DIVISION_II',
        'DIVISION_III'
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "tournament"
        ADD COLUMN IF NOT EXISTS "division" tournament_division_enum NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "tournament"
        ALTER COLUMN "prizePool" DROP NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "qualification" (
        "id"            uuid          NOT NULL DEFAULT gen_random_uuid(),
        "startTime"     timestamptz   NOT NULL,
        "endTime"       timestamptz   NOT NULL,
        "nodeGroupId"   varchar       NOT NULL,
        "tournamentId"  uuid          NOT NULL,
        CONSTRAINT "PK_qualification" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_qualification_tournament" UNIQUE ("tournamentId"),
        CONSTRAINT "FK_qualification_tournament"
          FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "qualification_match" (
        "id"              uuid      NOT NULL DEFAULT gen_random_uuid(),
        "dotaMatchId"     varchar           NULL,
        "nodeGroupId"     varchar   NOT NULL,
        "qualificationId" uuid      NOT NULL,
        "teamAId"         uuid      NOT NULL,
        "teamBId"         uuid      NOT NULL,
        "winnerId"        uuid              NULL,
        CONSTRAINT "PK_qualification_match" PRIMARY KEY ("id"),
        CONSTRAINT "FK_qm_qualification"
          FOREIGN KEY ("qualificationId") REFERENCES "qualification"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_qm_teamA"
          FOREIGN KEY ("teamAId") REFERENCES "team"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_qm_teamB"
          FOREIGN KEY ("teamBId") REFERENCES "team"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_qm_winner"
          FOREIGN KEY ("winnerId") REFERENCES "team"("id") ON DELETE SET NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "qualification_match"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "qualification"`);
    await queryRunner.query(`ALTER TABLE "tournament" DROP COLUMN IF EXISTS "division"`);
    await queryRunner.query(`DROP TYPE IF EXISTS tournament_division_enum`);
    await queryRunner.query(`ALTER TABLE "tournament" ALTER COLUMN "prizePool" SET NOT NULL`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS dota_node_group_seq`);
  }
}
