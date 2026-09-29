import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type { DuelStats, DuelStatsPlayer } from '../duels/duel.constants';
import { accountIdOf } from './dota-gc.protocol';

const URL =
  'https://api.steampowered.com/IDOTA2MatchStats_570/GetRealtimeStats/v1/';

/** Raw `GetRealtimeStats` payload; field names vary between Valve builds. */
export interface RealtimeStatsRaw {
  match?: {
    server_steam_id?: string;
    match_id?: string;
    matchid?: string;
    game_time?: number;
    game_mode?: number;
    timestamp?: number;
  };
  teams?: Array<{
    team_number?: number;
    players?: Array<Record<string, unknown>>;
  }>;
}

export interface StatsParticipant {
  playerId: string;
  steamId64: string;
}

function pick(p: Record<string, unknown>, ...names: string[]): number | null {
  for (const n of names) {
    const v = p[n];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

/**
 * Live scoreboard of a running game from the Steam Web API. 1v1 Mid
 * practice lobbies are not stored by Valve after the game, so this is the
 * only source of per-player stats: the worker polls it while the duel is
 * LIVE and keeps the last snapshot. Needs `STEAM_API_KEY`.
 */
@Injectable()
export class RealtimeStatsService {
  private readonly logger = new Logger(RealtimeStatsService.name);

  constructor(private readonly http: HttpService) {}

  get enabled(): boolean {
    return !!process.env.STEAM_API_KEY?.trim();
  }

  async fetch(serverSteamId: string): Promise<RealtimeStatsRaw | null> {
    const key = process.env.STEAM_API_KEY?.trim();
    if (!key) return null;
    try {
      const res = await firstValueFrom(
        this.http.get<RealtimeStatsRaw>(URL, {
          params: { key, server_steam_id: serverSteamId },
          timeout: 10_000,
          validateStatus: () => true,
        }),
      );
      if (res.status !== 200 || !res.data?.teams?.length) return null;
      return res.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`GetRealtimeStats(${serverSteamId}) failed: ${message}`);
      return null;
    }
  }

  /**
   * Raw snapshot → the compact per-duel summary we store. Sides come from
   * our own launch-time assignment when known (`radiantAccountId`), else from
   * the scoreboard's team number (2 = Radiant, 3 = Dire).
   */
  summarize(
    raw: RealtimeStatsRaw,
    participants: StatsParticipant[],
    matchOutcome: number | null,
    radiantAccountId: number | null,
    direAccountId: number | null,
  ): DuelStats {
    const byAccount = new Map<
      number,
      { team: number | undefined; p: Record<string, unknown> }
    >();
    for (const team of raw.teams ?? []) {
      for (const p of team.players ?? []) {
        const acc = pick(p, 'accountid', 'account_id');
        if (acc != null) byAccount.set(acc, { team: team.team_number, p });
      }
    }

    const players: DuelStatsPlayer[] = participants.map(
      ({ playerId, steamId64 }) => {
        const acc = accountIdOf(steamId64);
        const entry = byAccount.get(acc);
        if (!entry) {
          return {
            playerId,
            steamId64,
            heroId: null,
            kills: null,
            deaths: null,
            assists: null,
            lastHits: null,
            denies: null,
            netWorth: null,
            level: null,
            isRadiant: null,
            win: null,
          };
        }
        const isRadiant =
          radiantAccountId != null &&
          (acc === radiantAccountId || acc === direAccountId)
            ? acc === radiantAccountId
            : entry.team === 2;
        const win =
          matchOutcome == null
            ? null
            : (isRadiant && matchOutcome === 2) ||
              (!isRadiant && matchOutcome === 3);
        return {
          playerId,
          steamId64,
          heroId: pick(entry.p, 'heroid', 'hero_id'),
          kills: pick(entry.p, 'kill_count', 'kills'),
          deaths: pick(entry.p, 'death_count', 'deaths'),
          assists: pick(entry.p, 'assists_count', 'assists'),
          lastHits: pick(entry.p, 'last_hit_count', 'lh_count', 'last_hits'),
          denies: pick(entry.p, 'denies', 'denies_count'),
          netWorth: pick(entry.p, 'net_worth', 'networth'),
          level: pick(entry.p, 'level'),
          isRadiant,
          win,
        };
      },
    );

    return {
      durationSeconds: raw.match?.game_time ?? null,
      players,
    };
  }
}
