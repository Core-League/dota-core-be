import { MigrationInterface, QueryRunner } from 'typeorm';

const PLAYER_ID = '91ad1f9f-c360-4cc0-b39e-81d64443e9a6';
const KEEP_IDS = [
  '5c298c1d-33ce-4465-b2df-5b783c0513f9',
  '38c8837a-99b8-4262-937e-5fe2c58147bd',
];

/** One-off: remove duplicate user_roles rows for the admin player, keeping only the two canonical ones. */
export class CleanupDuplicateRolesForAdmin1746100000000
  implements MigrationInterface
{
  name = 'CleanupDuplicateRolesForAdmin1746100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "user_roles"
       WHERE "playerId" = $1
         AND "id" NOT IN ($2, $3)`,
      [PLAYER_ID, ...KEEP_IDS],
    );
  }

  public async down(): Promise<void> {
    await Promise.resolve();
  }
}
