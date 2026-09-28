import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type PlayerMatchStage = 'qualification' | 'playoff';

export interface PlayerMatchRow {
  matchId: string;
  stage: PlayerMatchStage;
  tournamentId: string;
  won: boolean;
}

/**
 * Read-side aggregation of a player's tournament matches, from our own
 * records only: every qualification / playoff map with a recorded winner
 * counts, whether it came from a Dota match id, a manual entry or a tech
 * loss. A player is credited through their team — current main roster or
 * captain, the same rule tournament points use.
 */
@Injectable()
export class PlayerMatchStatsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  findPlayedMaps(playerId: string): Promise<PlayerMatchRow[]> {
    return this.dataSource.query(
      `
      WITH member AS (
        SELECT "teamId" FROM team_main_players WHERE "playerId" = $1
        UNION
        SELECT id AS "teamId" FROM team WHERE "captainId" = $1
      ),
      maps AS (
        SELECT qm.id,
               'qualification'::text AS stage,
               q."tournamentId",
               qm."teamAId",
               qm."teamBId",
               qm."winnerId"
        FROM qualification_match qm
        JOIN qualification q ON q.id = qm."qualificationId"
        WHERE qm."winnerId" IS NOT NULL
        UNION ALL
        SELECT pm.id,
               'playoff'::text AS stage,
               p."tournamentId",
               pm."teamAId",
               pm."teamBId",
               pm."winnerId"
        FROM playoff_match pm
        JOIN playoff p ON p.id = pm."playoffId"
        WHERE pm."winnerId" IS NOT NULL
      )
      SELECT DISTINCT ON (m.id)
             m.id             AS "matchId",
             m.stage          AS "stage",
             m."tournamentId" AS "tournamentId",
             (m."winnerId" = mem."teamId") AS "won"
      FROM maps m
      JOIN member mem ON mem."teamId" IN (m."teamAId", m."teamBId")
      ORDER BY m.id
      `,
      [playerId],
    );
  }
}
