import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Player } from '../players/player.entity';
import { Team } from '../teams/team.entity';
import { MatchParticipant, MatchStage } from './match-participant.entity';

/** A recorded map that still has no participant rows (candidate for backfill). */
export interface PendingMatchRow {
  matchId: string;
  stage: MatchStage;
  tournamentId: string;
  teamAId: string;
  teamBId: string;
  winnerId: string;
  dotaMatchId: string;
}

/**
 * Finished qualification / playoff maps with a real (numeric) Dota match id,
 * both sides present and no participant rows yet. Manual and tech-loss ids
 * are not fetchable and are skipped.
 */
const PENDING_MAPS_SQL = `
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
  )
  SELECT m.id             AS "matchId",
         m.stage          AS "stage",
         m."tournamentId" AS "tournamentId",
         m."teamAId"      AS "teamAId",
         m."teamBId"      AS "teamBId",
         m."winnerId"     AS "winnerId",
         m."dotaMatchId"  AS "dotaMatchId"
  FROM maps m
  WHERE m."winnerId" IS NOT NULL
    AND m."teamAId" IS NOT NULL
    AND m."teamBId" IS NOT NULL
    AND m."dotaMatchId" ~ '^[0-9]+$'
    AND ($1::text IS NULL OR m."dotaMatchId"::bigint > $1::bigint)
    AND NOT EXISTS (
      SELECT 1 FROM match_participant mp
      WHERE mp.stage = m.stage AND mp."matchId" = m.id
    )
`;

@Injectable()
export class MatchParticipantsRepository {
  private readonly repo: Repository<MatchParticipant>;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository(MatchParticipant);
  }

  /** Insert or refresh rows; (stage, matchId, playerId) is the identity. */
  async upsertMany(rows: Partial<MatchParticipant>[]): Promise<void> {
    if (!rows.length) return;
    await this.repo.upsert(rows, {
      conflictPaths: ['stage', 'matchId', 'playerId'],
    });
  }

  findPlayersBySteamIds(
    steamIds: string[],
  ): Promise<Pick<Player, 'id' | 'steamId'>[]> {
    if (!steamIds.length) return Promise.resolve([]);
    return this.dataSource.getRepository(Player).find({
      where: { steamId: In(steamIds) },
      select: ['id', 'steamId'],
    });
  }

  findTeamsDotaIds(
    teamIds: string[],
  ): Promise<Pick<Team, 'id' | 'dotaTeamId'>[]> {
    if (!teamIds.length) return Promise.resolve([]);
    return this.dataSource.getRepository(Team).find({
      where: { id: In(teamIds) },
      select: ['id', 'dotaTeamId'],
    });
  }

  findPendingMatches(
    limit: number,
    afterDotaMatchId: string | null,
  ): Promise<PendingMatchRow[]> {
    return this.dataSource.query(
      `${PENDING_MAPS_SQL} ORDER BY m."dotaMatchId"::bigint LIMIT $2`,
      [afterDotaMatchId, limit],
    );
  }

  async countPendingMatches(afterDotaMatchId: string | null): Promise<number> {
    const rows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(*)::text AS count FROM (${PENDING_MAPS_SQL}) pending`,
      [afterDotaMatchId],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
