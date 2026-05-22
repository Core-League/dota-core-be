import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets `DELETE FROM team` succeed while preserving match rows:
 * FKs ON DELETE SET NULL for team slots; joins like tournament_team CASCADE-delete with the team.
 */
export class TeamDeleteSetNullMatchFks1779640000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qualification_match" DROP CONSTRAINT IF EXISTS "FK_qm_teamA"
    `);
    await queryRunner.query(`
      ALTER TABLE "qualification_match" DROP CONSTRAINT IF EXISTS "FK_qm_teamB"
    `);
    await queryRunner.query(`
      ALTER TABLE "qualification_match" ALTER COLUMN "teamAId" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "qualification_match" ALTER COLUMN "teamBId" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "qualification_match"
      ADD CONSTRAINT "FK_qm_teamA"
        FOREIGN KEY ("teamAId") REFERENCES "team" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "qualification_match"
      ADD CONSTRAINT "FK_qm_teamB"
        FOREIGN KEY ("teamBId") REFERENCES "team" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "playoff_match" DROP CONSTRAINT IF EXISTS "FK_playoff_match_teamA"
    `);
    await queryRunner.query(`
      ALTER TABLE "playoff_match" DROP CONSTRAINT IF EXISTS "FK_playoff_match_teamB"
    `);
    await queryRunner.query(`
      ALTER TABLE "playoff_match" ALTER COLUMN "teamAId" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "playoff_match" ALTER COLUMN "teamBId" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "playoff_match"
      ADD CONSTRAINT "FK_playoff_match_teamA"
        FOREIGN KEY ("teamAId") REFERENCES "team" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "playoff_match"
      ADD CONSTRAINT "FK_playoff_match_teamB"
        FOREIGN KEY ("teamBId") REFERENCES "team" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        r RECORD;
        match_oid oid;
        team_oid oid;
      BEGIN
        SELECT c.oid INTO match_oid
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'match' AND n.nspname = 'public';
        IF match_oid IS NULL THEN
          RETURN;
        END IF;
        SELECT c.oid INTO team_oid
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'team' AND n.nspname = 'public';
        IF team_oid IS NULL THEN
          RETURN;
        END IF;
        FOR r IN (
          SELECT c.conname
          FROM pg_constraint c
          WHERE c.conrelid = match_oid AND c.confrelid = team_oid AND c.contype = 'f'
        ) LOOP
          EXECUTE format('ALTER TABLE "match" DROP CONSTRAINT %I', r.conname);
        END LOOP;
        ALTER TABLE "match" ALTER COLUMN "teamAId" DROP NOT NULL;
        ALTER TABLE "match" ALTER COLUMN "teamBId" DROP NOT NULL;
        ALTER TABLE "match" ALTER COLUMN "winnerId" DROP NOT NULL;
        ALTER TABLE "match"
          ADD CONSTRAINT "FK_match_teamA"
            FOREIGN KEY ("teamAId") REFERENCES "team" ("id") ON DELETE SET NULL;
        ALTER TABLE "match"
          ADD CONSTRAINT "FK_match_teamB"
            FOREIGN KEY ("teamBId") REFERENCES "team" ("id") ON DELETE SET NULL;
        ALTER TABLE "match"
          ADD CONSTRAINT "FK_match_winner"
            FOREIGN KEY ("winnerId") REFERENCES "team" ("id") ON DELETE SET NULL;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Forward-only: reverting breaks if match rows contain NULL side references.
  }
}
