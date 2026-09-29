import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { PlayoffFinalType } from '../playoff/playoff-series.entity';
import { TournamentBracketType } from '../tournaments/tournaments.model';

/** A decided playoff series together with the tournament it belongs to. */
export interface PlacementSeriesWithTournamentRow {
  id: string;
  finalType: PlayoffFinalType | null;
  teamAId: string | null;
  teamBId: string | null;
  seriesWinnerId: string | null;
  tournamentId: string;
  tournamentName: string;
  bracketType: TournamentBracketType;
  hasThirdPlaceMatch: boolean;
}

/** A team the player is credited through, either in one tournament or (current roster) in all of them. */
export interface PlayerTeamCreditRow {
  /** null — current main roster / captain, counts for every tournament. */
  tournamentId: string | null;
  teamId: string;
}

/** The player's map record next to the platform-wide maxima, on the same counting rule as match stats. */
export interface PlayerMatchRecordRow {
  played: number;
  won: number;
  lost: number;
  maxPlayed: number;
  maxWon: number;
  maxLost: number;
}

export interface PlayerRatingRecordRow {
  /** null when the player is not verified — unverified ratings are self-reported. */
  rating: number | null;
  maxRating: number | null;
}

/**
 * Read-side queries behind the profile trophies. Everything is computed on
 * request from our own records; nothing is persisted, so a re-submitted result
 * or a regenerated bracket is reflected immediately.
 */
@Injectable()
export class PlayerAchievementsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Every series of every playoff whose grand final has a winner — enough to derive 1st–3rd. */
  findDecidedPlayoffSeries(): Promise<PlacementSeriesWithTournamentRow[]> {
    return this.dataSource.query(
      `
      SELECT ps.id,
             ps."finalType"        AS "finalType",
             ps."teamAId"          AS "teamAId",
             ps."teamBId"          AS "teamBId",
             ps."seriesWinnerId"   AS "seriesWinnerId",
             p."tournamentId"      AS "tournamentId",
             t.name                AS "tournamentName",
             t."bracketType"       AS "bracketType",
             t."hasThirdPlaceMatch" AS "hasThirdPlaceMatch"
      FROM playoff_series ps
      JOIN playoff p ON p.id = ps."playoffId"
      JOIN tournament t ON t.id = p."tournamentId"
      WHERE EXISTS (
        SELECT 1
        FROM playoff_series gf
        WHERE gf."playoffId" = ps."playoffId"
          AND gf."finalType" = 'grand_final'
          AND gf."seriesWinnerId" IS NOT NULL
      )
      ORDER BY p."tournamentId", ps."createdAt"
      `,
    );
  }

  /**
   * Teams a player earns a placement through: the side they actually played on
   * in that tournament (match participants) plus, like match stats and
   * tournament points, the teams they currently belong to as main roster or captain.
   */
  findPlayerTeamCredits(playerId: string): Promise<PlayerTeamCreditRow[]> {
    return this.dataSource.query(
      `
      SELECT DISTINCT mp."tournamentId" AS "tournamentId", mp."teamId" AS "teamId"
      FROM match_participant mp
      WHERE mp."playerId" = $1 AND mp."teamId" IS NOT NULL
      UNION
      SELECT NULL AS "tournamentId", tmp."teamId" AS "teamId"
      FROM team_main_players tmp
      WHERE tmp."playerId" = $1
      UNION
      SELECT NULL AS "tournamentId", tm.id AS "teamId"
      FROM team tm
      WHERE tm."captainId" = $1
      `,
      [playerId],
    );
  }

  /**
   * Maps played / won / lost for the player and the highest such counts on the
   * platform. Same rule as `PlayerMatchStatsRepository`: every qualification or
   * playoff map with a recorded winner, credited through the current main
   * roster or captaincy.
   */
  async findMatchRecord(playerId: string): Promise<PlayerMatchRecordRow> {
    const rows: Array<
      Record<keyof PlayerMatchRecordRow, string | number | null>
    > = await this.dataSource.query(
      `
      WITH maps AS (
        SELECT qm.id, qm."teamAId", qm."teamBId", qm."winnerId"
        FROM qualification_match qm
        WHERE qm."winnerId" IS NOT NULL
        UNION ALL
        SELECT pm.id, pm."teamAId", pm."teamBId", pm."winnerId"
        FROM playoff_match pm
        WHERE pm."winnerId" IS NOT NULL
      ),
      member AS (
        SELECT "teamId", "playerId" FROM team_main_players
        UNION
        SELECT id AS "teamId", "captainId" AS "playerId" FROM team WHERE "captainId" IS NOT NULL
      ),
      per_player AS (
        SELECT mem."playerId",
               COUNT(DISTINCT m.id) AS played,
               COUNT(DISTINCT m.id) FILTER (WHERE m."winnerId" = mem."teamId") AS won
        FROM maps m
        JOIN member mem ON mem."teamId" IN (m."teamAId", m."teamBId")
        GROUP BY mem."playerId"
      ),
      mine AS (
        SELECT played, won FROM per_player WHERE "playerId" = $1
      )
      SELECT COALESCE((SELECT played FROM mine), 0)                    AS "played",
             COALESCE((SELECT won FROM mine), 0)                       AS "won",
             COALESCE((SELECT played - won FROM mine), 0)              AS "lost",
             COALESCE((SELECT MAX(played) FROM per_player), 0)         AS "maxPlayed",
             COALESCE((SELECT MAX(won) FROM per_player), 0)            AS "maxWon",
             COALESCE((SELECT MAX(played - won) FROM per_player), 0)   AS "maxLost"
      `,
      [playerId],
    );
    const row = rows[0];
    return {
      played: Number(row?.played ?? 0),
      won: Number(row?.won ?? 0),
      lost: Number(row?.lost ?? 0),
      maxPlayed: Number(row?.maxPlayed ?? 0),
      maxWon: Number(row?.maxWon ?? 0),
      maxLost: Number(row?.maxLost ?? 0),
    };
  }

  /**
   * The player's rating and the top rating among verified players. Unverified
   * players may type any rating into their profile, so they neither hold nor
   * block the record.
   */
  async findRatingRecord(playerId: string): Promise<PlayerRatingRecordRow> {
    const rows: Array<{ rating: number | null; maxRating: number | null }> =
      await this.dataSource.query(
        `
      SELECT (SELECT rating FROM player WHERE id = $1 AND "verifiedAt" IS NOT NULL) AS "rating",
             (SELECT MAX(rating) FROM player WHERE "verifiedAt" IS NOT NULL)        AS "maxRating"
      `,
        [playerId],
      );
    const row = rows[0];
    return {
      rating: row?.rating == null ? null : Number(row.rating),
      maxRating: row?.maxRating == null ? null : Number(row.maxRating),
    };
  }
}
