import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { PlayoffFinalType } from '../playoff/playoff-series.entity';
import { TournamentBracketType } from '../tournaments/tournaments.model';
import type { MatchStage } from '../match-participants/match-participant.entity';

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

/** A team a player is credited through, either in one tournament or (current roster) in all of them. */
export interface PlayerTeamCreditRow {
  playerId: string;
  /** null — current main roster / captain, counts for every tournament. */
  tournamentId: string | null;
  teamId: string;
}

/** One map credited to one player through the current roster / captaincy rule. */
export interface PlayerMapResultRow {
  playerId: string;
  matchId: string;
  stage: MatchStage;
  tournamentId: string;
  tournamentName: string;
  won: boolean;
}

/** One player's line from one recorded map (who actually played, per the Dota match data). */
export interface ParticipantRow {
  playerId: string;
  matchId: string;
  stage: MatchStage;
  tournamentId: string;
  teamId: string | null;
  heroId: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  isRadiant: boolean;
  /** Live match winner when the side is known, otherwise the outcome stored at record time. */
  won: boolean;
  createdAt: Date;
}

/** Profile facts behind the community trophies plus what the board needs to render a holder. */
export interface AchievementPlayerRow {
  id: string;
  discordName: string | null;
  discordUsername: string | null;
  avatarUrl: string | null;
  rating: number;
  verifiedAt: Date | null;
  steamId: string | null;
  discordId: string | null;
  telegramId: string | null;
  wantToPlay: string[] | null;
  lanCities: string[] | null;
  isCaptain: boolean;
}

export interface PlayerPointsRow {
  playerId: string;
  points: number;
}

export interface PlayerDonationsRow {
  playerId: string;
  donations: number;
  amountPaid: number;
}

/**
 * Read-side loaders behind the trophies. Each returns the whole platform in
 * one round trip; `PlayerAchievementsService` turns them into a board for
 * every player at once. Nothing is persisted, so a re-submitted result or a
 * regenerated bracket is reflected on the next computation.
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
   * Who a placement is credited to: the side a player actually played on in
   * that tournament (match participants) plus, like match stats and tournament
   * points, the teams they currently belong to as main roster or captain.
   */
  findAllTeamCredits(): Promise<PlayerTeamCreditRow[]> {
    return this.dataSource.query(
      `
      SELECT DISTINCT mp."playerId" AS "playerId", mp."tournamentId" AS "tournamentId", mp."teamId" AS "teamId"
      FROM match_participant mp
      WHERE mp."teamId" IS NOT NULL
      UNION
      SELECT tmp."playerId" AS "playerId", NULL AS "tournamentId", tmp."teamId" AS "teamId"
      FROM team_main_players tmp
      UNION
      SELECT tm."captainId" AS "playerId", NULL AS "tournamentId", tm.id AS "teamId"
      FROM team tm
      WHERE tm."captainId" IS NOT NULL
      `,
    );
  }

  /**
   * Every recorded map credited to every player — the rule
   * `PlayerMatchStatsRepository` uses for profile stats: each qualification or
   * playoff map with a winner, through the current main roster or captaincy.
   */
  findAllMapResults(): Promise<PlayerMapResultRow[]> {
    return this.dataSource.query(
      `
      WITH maps AS (
        SELECT qm.id, 'qualification'::text AS stage, q."tournamentId", qm."teamAId", qm."teamBId", qm."winnerId"
        FROM qualification_match qm
        JOIN qualification q ON q.id = qm."qualificationId"
        WHERE qm."winnerId" IS NOT NULL
        UNION ALL
        SELECT pm.id, 'playoff'::text AS stage, p."tournamentId", pm."teamAId", pm."teamBId", pm."winnerId"
        FROM playoff_match pm
        JOIN playoff p ON p.id = pm."playoffId"
        WHERE pm."winnerId" IS NOT NULL
      ),
      member AS (
        SELECT "teamId", "playerId" FROM team_main_players
        UNION
        SELECT id AS "teamId", "captainId" AS "playerId" FROM team WHERE "captainId" IS NOT NULL
      )
      SELECT DISTINCT ON (mem."playerId", m.id)
             mem."playerId"                    AS "playerId",
             m.id                              AS "matchId",
             m.stage                           AS "stage",
             m."tournamentId"                  AS "tournamentId",
             t.name                            AS "tournamentName",
             (m."winnerId" = mem."teamId")     AS "won"
      FROM maps m
      JOIN member mem ON mem."teamId" IN (m."teamAId", m."teamBId")
      JOIN tournament t ON t.id = m."tournamentId"
      ORDER BY mem."playerId", m.id
      `,
    );
  }

  /**
   * Per-player lines of every recorded map, oldest first. Rows whose match row
   * is gone (regenerated playoff) are dropped by the lateral join; the outcome
   * prefers the live winner when the player's side is known.
   */
  async findAllParticipants(): Promise<ParticipantRow[]> {
    const rows: Array<
      Omit<ParticipantRow, 'kills' | 'deaths' | 'assists' | 'heroId'> & {
        kills: number | string | null;
        deaths: number | string | null;
        assists: number | string | null;
        heroId: number | string | null;
      }
    > = await this.dataSource.query(
      `
      SELECT mp."playerId"    AS "playerId",
             mp."matchId"     AS "matchId",
             mp.stage         AS "stage",
             mp."tournamentId" AS "tournamentId",
             mp."teamId"      AS "teamId",
             mp."heroId"      AS "heroId",
             mp.kills         AS "kills",
             mp.deaths        AS "deaths",
             mp.assists       AS "assists",
             mp."isRadiant"   AS "isRadiant",
             mp."createdAt"   AS "createdAt",
             COALESCE(
               CASE WHEN mp."teamId" IS NOT NULL AND live."winnerId" IS NOT NULL
                    THEN live."winnerId" = mp."teamId" END,
               mp.won
             ) AS "won"
      FROM match_participant mp
      JOIN LATERAL (
        SELECT qm."winnerId" FROM qualification_match qm
        WHERE mp.stage = 'qualification' AND qm.id = mp."matchId"
        UNION ALL
        SELECT pm."winnerId" FROM playoff_match pm
        WHERE mp.stage = 'playoff' AND pm.id = mp."matchId"
      ) live ON TRUE
      ORDER BY mp."createdAt", mp."matchId"
      `,
    );
    const num = (v: number | string | null) => (v == null ? null : Number(v));
    return rows.map((r) => ({
      ...r,
      heroId: num(r.heroId),
      kills: num(r.kills),
      deaths: num(r.deaths),
      assists: num(r.assists),
      createdAt: new Date(r.createdAt),
    }));
  }

  /** Every player with the profile facts the community trophies look at. */
  async findAllPlayers(): Promise<AchievementPlayerRow[]> {
    const rows: Array<
      Omit<AchievementPlayerRow, 'rating'> & { rating: number | string }
    > = await this.dataSource.query(
      `
      SELECT p.id,
             p."discordName"     AS "discordName",
             p."discordUsername" AS "discordUsername",
             p."avatarUrl"       AS "avatarUrl",
             p.rating            AS "rating",
             p."verifiedAt"      AS "verifiedAt",
             p."steamId"         AS "steamId",
             p."discordId"       AS "discordId",
             p."telegramId"      AS "telegramId",
             p."wantToPlay"      AS "wantToPlay",
             p."lanCities"       AS "lanCities",
             EXISTS (
               SELECT 1 FROM team t WHERE t."captainId" = p.id AND t."disbandedAt" IS NULL
             ) AS "isCaptain"
      FROM player p
      `,
    );
    return rows.map((r) => ({ ...r, rating: Number(r.rating) }));
  }

  /** Lifetime qualification points per player. */
  async findTournamentPointsTotals(): Promise<PlayerPointsRow[]> {
    const rows: Array<{ playerId: string; points: string | number }> =
      await this.dataSource.query(
        `SELECT "playerId", SUM(points) AS points FROM player_tournament_points GROUP BY "playerId"`,
      );
    return rows.map((r) => ({
      playerId: r.playerId,
      points: Number(r.points),
    }));
  }

  /** Paid tournament donations per donor. */
  async findPaidDonations(): Promise<PlayerDonationsRow[]> {
    const rows: Array<{
      playerId: string;
      donations: string | number;
      amountPaid: string | number;
    }> = await this.dataSource.query(
      `
      SELECT "donorPlayerId" AS "playerId", COUNT(*) AS donations, SUM("amountPaid") AS "amountPaid"
      FROM tournament_donation
      WHERE status = 'PAID' AND "donorPlayerId" IS NOT NULL
      GROUP BY "donorPlayerId"
      `,
    );
    return rows.map((r) => ({
      playerId: r.playerId,
      donations: Number(r.donations),
      amountPaid: Number(r.amountPaid),
    }));
  }
}
