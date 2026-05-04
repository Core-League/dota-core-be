import { MigrationInterface, QueryRunner } from 'typeorm';

const PLAYER_ID = '392bdc41-f8b0-47d3-8fa6-32f4b824c323';

export class RemoveTeamForPlayer392bdc411746300000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        v_team_id uuid;
      BEGIN
        SELECT id INTO v_team_id
        FROM team
        WHERE "captainId" = '${PLAYER_ID}';

        IF v_team_id IS NULL THEN
          RAISE NOTICE 'No team found for player ${PLAYER_ID}, skipping';
          RETURN;
        END IF;

        -- Clear denormalized teamId on all players belonging to this team
        UPDATE player
        SET "teamId" = NULL
        WHERE "teamId" = v_team_id::varchar;

        -- Remove qualification matches before team delete (FK is RESTRICT)
        DELETE FROM qualification_match
        WHERE "teamAId" = v_team_id OR "teamBId" = v_team_id;

        -- Remove roster join table entries
        DELETE FROM team_main_players WHERE "teamId" = v_team_id;
        DELETE FROM team_reserved_players WHERE "teamId" = v_team_id;

        -- Delete the team itself
        DELETE FROM team WHERE id = v_team_id;

        -- Remove the captain role from the player
        DELETE FROM user_roles
        WHERE "playerId" = '${PLAYER_ID}'
          AND name = 'Капітан';

      END $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Data deletion cannot be reversed automatically
  }
}
