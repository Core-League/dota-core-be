import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorTournamentStatus1746500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create new enum type
    await queryRunner.query(`
      CREATE TYPE tournament_status_new AS ENUM ('QUALIFICATIONS', 'PLAYOFF', 'COMPLETED');
    `);

    // Migrate existing rows: map old values to new ones
    await queryRunner.query(`
      ALTER TABLE tournament
        ALTER COLUMN "tournamentStatus" TYPE tournament_status_new
        USING (
          CASE "tournamentStatus"::text
            WHEN 'REGISTRATION_OPEN'   THEN 'QUALIFICATIONS'
            WHEN 'REGISTRATION_CLOSED' THEN 'QUALIFICATIONS'
            WHEN 'SCHEDULED'           THEN 'QUALIFICATIONS'
            WHEN 'IN_PROGRESS'         THEN 'PLAYOFF'
            WHEN 'COMPLETED'           THEN 'COMPLETED'
          END
        )::tournament_status_new;
    `);

    // Drop old enum type
    await queryRunner.query(`DROP TYPE tournament_tournamentstatus_enum;`);

    // Rename new type to the name TypeORM expects
    await queryRunner.query(
      `ALTER TYPE tournament_status_new RENAME TO tournament_tournamentstatus_enum;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE tournament_status_old AS ENUM (
        'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'SCHEDULED'
      );
    `);

    await queryRunner.query(`
      ALTER TABLE tournament
        ALTER COLUMN "tournamentStatus" TYPE tournament_status_old
        USING (
          CASE "tournamentStatus"::text
            WHEN 'QUALIFICATIONS' THEN 'REGISTRATION_OPEN'
            WHEN 'PLAYOFF'        THEN 'IN_PROGRESS'
            WHEN 'COMPLETED'      THEN 'COMPLETED'
          END
        )::tournament_status_old;
    `);

    await queryRunner.query(`DROP TYPE tournament_tournamentstatus_enum;`);
    await queryRunner.query(
      `ALTER TYPE tournament_status_old RENAME TO tournament_tournamentstatus_enum;`,
    );
  }
}
