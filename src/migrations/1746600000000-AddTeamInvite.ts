import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTeamInvite1746600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE team_invite (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token VARCHAR(64) NOT NULL,
        "teamId" UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
        "createdById" UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
        slot VARCHAR NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_team_invite_token ON team_invite(token);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE team_invite;`);
  }
}
