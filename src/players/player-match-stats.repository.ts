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
 * Read-side aggregation of a player's tournament maps.
 *
 * Primary source: `match_participant` — who really played, from the Dota match
 * data (submission hook + admin backfill). Outcome is taken from the live
 * match winner so admin overrides are reflected without rewriting rows.
 *
 * Fallback, only for maps that have no participant rows at all (not yet
 * backfilled, manual entries without Dota data): the team's current main
 * roster / captain, as tournament points do. Tech losses are forfeits and
 * are never credited through the fallback.
 */
@Injectable()
export class PlayerMatchStatsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  findPlayedMaps(playerId: string): Promise<PlayerMatchRow[]> {
    return this.dataSource.query(
      `
      WITH maps AS (
        SELECT qm.id,
               'qualification'::text AS stage,
               q."tournamentId",
               qm."teamAId",
               qm."teamBId",
               qm."winnerId",
               qm."dotaMatchId"
        FROM qualification_match qm
        JOIN qualification q ON q.id = qm."qualificationId"
        WHERE qm."winnerId" IS NOT NULL
        UNION ALL
        SELECT pm.id,
               'playoff'::text AS stage,
               p."tournamentId",
               pm."teamAId",
               pm."teamBId",
               pm."winnerId",
               pm."dotaMatchId"
        FROM playoff_match pm
        JOIN playoff p ON p.id = pm."playoffId"
        WHERE pm."winnerId" IS NOT NULL
      ),
      member AS (
        SELECT "teamId" FROM team_main_players WHERE "playerId" = $1
        UNION
        SELECT id AS "teamId" FROM team WHERE "captainId" = $1
      )
      SELECT m.id             AS "matchId",
             m.stage          AS "stage",
             m."tournamentId" AS "tournamentId",
             CASE
               WHEN mp."teamId" IS NOT NULL THEN mp."teamId" = m."winnerId"
               ELSE mp.won
             END              AS "won"
      FROM match_participant mp
      JOIN maps m ON m.id = mp."matchId" AND m.stage = mp.stage
      WHERE mp."playerId" = $1
      UNION ALL
      (
        SELECT DISTINCT ON (m.id)
               m.id             AS "matchId",
               m.stage          AS "stage",
               m."tournamentId" AS "tournamentId",
               (m."winnerId" = mem."teamId") AS "won"
        FROM maps m
        JOIN member mem ON mem."teamId" IN (m."teamAId", m."teamBId")
        WHERE NOT EXISTS (
          SELECT 1 FROM match_participant x
          WHERE x.stage = m.stage AND x."matchId" = m.id
        )
          AND (m."dotaMatchId" IS NULL OR m."dotaMatchId" NOT LIKE 'tech\\_loss\\_%')
        ORDER BY m.id
      )
      `,
      [playerId],
    );
  }
}
