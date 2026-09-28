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
 * Read-side aggregation of a player's tournament maps. Membership is the
 * team's current main roster / captain (same rule as tournament points), so a
 * player who left a team keeps its history while they are on it and loses it
 * after. Reserves are not credited: the roster check on submission lets them
 * play, but nothing records whether they did.
 */
@Injectable()
export class PlayerMatchStatsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Every finished qualification / playoff map involving one of the player's
   * teams. Tech losses (`tech_loss_*`) are forfeits, not played maps, and are
   * left out. Maps without a winner are still open.
   */
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
      )
      SELECT DISTINCT ON (m.id)
             m.id            AS "matchId",
             m.stage         AS "stage",
             m."tournamentId" AS "tournamentId",
             (m."winnerId" = mem."teamId") AS "won"
      FROM maps m
      JOIN member mem ON mem."teamId" IN (m."teamAId", m."teamBId")
      WHERE m."dotaMatchId" IS NULL OR m."dotaMatchId" NOT LIKE 'tech\\_loss\\_%'
      ORDER BY m.id
      `,
      [playerId],
    );
  }
}
