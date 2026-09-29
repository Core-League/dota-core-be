import { Injectable, Logger } from '@nestjs/common';
import { Dota2Service, OpenDotaMatch } from '../dota2/dota2.service';
import { BackfillMatchParticipantsReportDto } from './dto/backfill-match-participants.dto';
import { MatchParticipant, MatchStage } from './match-participant.entity';
import {
  MatchParticipantsRepository,
  PendingMatchRow,
} from './match-participants.repository';

const STEAM_ID_OFFSET = 76561197960265728n;

function accountIdToSteamId64(accountId: number): string {
  return (BigInt(accountId) + STEAM_ID_OFFSET).toString();
}

/** OpenDota's anonymous rate limit is 60 req/min; stay comfortably under it. */
const BACKFILL_INTERVAL_MS = 1100;
const BACKFILL_DEFAULT_LIMIT = 20;
const BACKFILL_MAX_LIMIT = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Core-side identity of a recorded map. */
export interface RecordMatchContext {
  stage: MatchStage;
  matchId: string;
  tournamentId: string;
  dotaMatchId: string;
  teamAId: string;
  teamBId: string;
  winnerId: string;
}

@Injectable()
export class MatchParticipantsService {
  private readonly logger = new Logger(MatchParticipantsService.name);

  constructor(
    private readonly repo: MatchParticipantsRepository,
    private readonly dota2: Dota2Service,
  ) {}

  /**
   * Persist who played a map from its Dota match data. Never throws: a result
   * submission must not fail because statistics could not be written.
   */
  async recordFromDota(
    ctx: RecordMatchContext,
    match: OpenDotaMatch,
  ): Promise<number> {
    try {
      return await this.record(ctx, match);
    } catch (err) {
      this.logger.warn(
        `Could not record participants for ${ctx.stage} map ${ctx.matchId} (dota ${ctx.dotaMatchId})`,
        err,
      );
      return 0;
    }
  }

  /**
   * Forget who played a map — used when its Dota match id is detached or
   * replaced, so statistics never mix two different games.
   */
  removeForMatch(stage: MatchStage, matchId: string): Promise<number> {
    return this.repo.deleteForMatch(stage, matchId);
  }

  /**
   * Walk recorded maps that have no participant rows yet, oldest Dota match
   * first, and fill them from OpenDota. Resumable via `afterDotaMatchId`;
   * failures are reported and skipped so one broken map cannot block the rest.
   */
  async backfill(opts: {
    limit?: number;
    afterDotaMatchId?: string | null;
  }): Promise<BackfillMatchParticipantsReportDto> {
    const limit = Math.min(
      Math.max(1, opts.limit ?? BACKFILL_DEFAULT_LIMIT),
      BACKFILL_MAX_LIMIT,
    );
    const after = opts.afterDotaMatchId?.trim() || null;
    const pending = await this.repo.findPendingMatches(limit, after);

    const report: BackfillMatchParticipantsReportDto = {
      processed: pending.length,
      recorded: 0,
      participants: 0,
      failed: [],
      lastDotaMatchId: after,
      remaining: 0,
    };

    for (const [i, row] of pending.entries()) {
      if (i > 0) await sleep(BACKFILL_INTERVAL_MS);
      report.lastDotaMatchId = row.dotaMatchId;
      try {
        const data = await this.dota2.getOpenDotaMatch(row.dotaMatchId);
        const written = await this.record(this.toContext(row), data);
        if (written === 0) {
          report.failed.push({
            stage: row.stage,
            matchId: row.matchId,
            dotaMatchId: row.dotaMatchId,
            error:
              'No match player maps to a Core player (Steam not linked or anonymous accounts)',
          });
          continue;
        }
        report.recorded += 1;
        report.participants += written;
      } catch (err) {
        report.failed.push({
          stage: row.stage,
          matchId: row.matchId,
          dotaMatchId: row.dotaMatchId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    report.remaining = await this.repo.countPendingMatches(
      report.lastDotaMatchId,
    );
    return report;
  }

  private toContext(row: PendingMatchRow): RecordMatchContext {
    return {
      stage: row.stage,
      matchId: row.matchId,
      tournamentId: row.tournamentId,
      dotaMatchId: row.dotaMatchId,
      teamAId: row.teamAId,
      teamBId: row.teamBId,
      winnerId: row.winnerId,
    };
  }

  private async record(
    ctx: RecordMatchContext,
    match: OpenDotaMatch,
  ): Promise<number> {
    const players = (match.players ?? []).filter(
      (p) => Number.isFinite(p.account_id) && p.account_id > 0,
    );
    if (!players.length) return 0;

    const steamIds = [
      ...new Set(players.map((p) => accountIdToSteamId64(p.account_id))),
    ];
    const known = await this.repo.findPlayersBySteamIds(steamIds);
    const playerIdBySteamId = new Map(
      known.map((p) => [p.steamId as string, p.id]),
    );
    if (!playerIdBySteamId.size) return 0;

    const radiantTeamId = await this.resolveRadiantTeamId(ctx, match);
    const direTeamId =
      radiantTeamId === ctx.teamAId ? ctx.teamBId : ctx.teamAId;

    const rows: Partial<MatchParticipant>[] = [];
    for (const p of players) {
      const playerId = playerIdBySteamId.get(
        accountIdToSteamId64(p.account_id),
      );
      if (!playerId) continue;
      const isRadiant =
        typeof p.isRadiant === 'boolean' ? p.isRadiant : p.player_slot < 128;
      rows.push({
        stage: ctx.stage,
        matchId: ctx.matchId,
        tournamentId: ctx.tournamentId,
        dotaMatchId: ctx.dotaMatchId,
        playerId,
        teamId: isRadiant ? radiantTeamId : direTeamId,
        isRadiant,
        won: isRadiant === match.radiant_win,
        heroId: p.hero_id > 0 ? p.hero_id : null,
        kills: Number.isFinite(p.kills) ? p.kills : null,
        deaths: Number.isFinite(p.deaths) ? p.deaths : null,
        assists: Number.isFinite(p.assists) ? p.assists : null,
      });
    }

    await this.repo.upsertMany(rows);
    return rows.length;
  }

  /**
   * Which Core team was Radiant. Prefer the Dota team ids on the match; fall
   * back to the recorded winner being on the winning side, which also covers
   * teams that changed their Dota team id since.
   */
  private async resolveRadiantTeamId(
    ctx: RecordMatchContext,
    match: OpenDotaMatch,
  ): Promise<string> {
    const radiantDotaId = String(
      match.radiant_team_id ?? match.radiant_team?.team_id ?? '',
    );
    const direDotaId = String(
      match.dire_team_id ?? match.dire_team?.team_id ?? '',
    );

    if (radiantDotaId || direDotaId) {
      const teams = await this.repo.findTeamsDotaIds([
        ctx.teamAId,
        ctx.teamBId,
      ]);
      const dotaIdOf = (id: string) =>
        teams.find((t) => t.id === id)?.dotaTeamId ?? '';
      const a = dotaIdOf(ctx.teamAId);
      const b = dotaIdOf(ctx.teamBId);
      if (radiantDotaId && radiantDotaId === a) return ctx.teamAId;
      if (radiantDotaId && radiantDotaId === b) return ctx.teamBId;
      if (direDotaId && direDotaId === a) return ctx.teamBId;
      if (direDotaId && direDotaId === b) return ctx.teamAId;
    }

    const loserId = ctx.winnerId === ctx.teamAId ? ctx.teamBId : ctx.teamAId;
    return match.radiant_win ? ctx.winnerId : loserId;
  }
}
