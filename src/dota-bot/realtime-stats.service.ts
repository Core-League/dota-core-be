import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type { DuelStats, DuelStatsPlayer } from '../duels/duel.constants';
import type { Duel } from '../duels/duel.entity';
import { accountIdOf, type GcMatchDetails } from './dota-gc.protocol';

const URL =
  'https://api.steampowered.com/IDOTA2MatchStats_570/GetRealtimeStats/v1/';
const MATCH_DETAILS_URL =
  'https://api.steampowered.com/IDOTA2Match_570/GetMatchDetails/v1/';

/** Raw `GetRealtimeStats` payload; field names vary between Valve builds. */
export interface RealtimeStatsRaw {
  match?: {
    server_steam_id?: string;
    match_id?: string;
    matchid?: string;
    game_time?: number;
    /** DOTA_GameState: 5 in progress, 6 post game, 7 disconnect */
    game_state?: number;
    game_mode?: number;
    timestamp?: number;
  };
  teams?: Array<{
    team_number?: number;
    /** Team kills */
    score?: number;
    players?: Array<Record<string, unknown>>;
  }>;
  buildings?: Array<{
    /** 2 Radiant, 3 Dire */
    team?: number;
    /** 0 tower, 1 barracks, 2 ancient */
    type?: number;
    tier?: number;
    lane?: number;
    destroyed?: boolean;
  }>;
}

export interface StatsParticipant {
  playerId: string;
  steamId64: string;
}

/** `GetMatchDetails` result, trimmed to what a duel needs. */
export interface WebApiMatch {
  radiant_win: boolean;
  duration?: number;
  players?: Array<Record<string, unknown>>;
}

/** What one Web API match gives a duel: winner, heroes actually played, per-player stats. */
export interface WebApiResult {
  outcome: number;
  heroesPlayed: Array<{ playerId: string; heroId: number }>;
  stats: DuelStats;
}

/** The two players of a duel as the stats service wants them; a player without a Steam link is skipped. */
export function duelParticipants(
  duel: Pick<Duel, 'player1' | 'player2'>,
): StatsParticipant[] {
  return [duel.player1, duel.player2]
    .filter(
      (p): p is NonNullable<typeof p> & { steamId: string } => !!p?.steamId,
    )
    .map((p) => ({ playerId: p.id, steamId64: p.steamId }));
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
      if (res.status !== 200 || !res.data?.teams?.length) {
        // Logged so an outage is told apart from the server shutting down:
        // Valve answers 5xx for a few seconds fairly often mid-game.
        this.logger.warn(
          `GetRealtimeStats(${serverSteamId}): HTTP ${res.status}, ${
            res.data?.teams?.length ? 'teams present' : 'no teams'
          }${res.data?.match?.game_state != null ? `, state=${res.data.match.game_state}` : ''}`,
        );
        return null;
      }
      return res.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`GetRealtimeStats(${serverSteamId}) failed: ${message}`);
      return null;
    }
  }

  /**
   * Winner of a 1v1 Solo Mid game read off the live scoreboard, by the mode's
   * own rules: first to two kills, or the enemy tier-1 tower down. Valve keeps
   * no record of practice 1v1 games and the GC drops the lobby the moment the
   * match ends, so this snapshot, taken while the server is still up for the
   * post-game screen, is the result. `EMatchOutcome` (2 Radiant, 3 Dire) or
   * null when the snapshot shows no finished game.
   *
   * `gameOver` — the caller knows the game ended (the server vanished), so a
   * plain kill lead decides even when the snapshot's state still says
   * "in progress": the last poll can easily predate the final kill.
   */
  deriveOutcome1v1(
    raw: RealtimeStatsRaw,
    opts: { gameOver?: boolean } = {},
  ): number | null {
    const kills = new Map<number, number>();
    for (const team of raw.teams ?? []) {
      if (team.team_number == null) continue;
      const fromPlayers = (team.players ?? []).reduce(
        (sum, p) => sum + (pick(p, 'kill_count', 'kills') ?? 0),
        0,
      );
      kills.set(team.team_number, Math.max(team.score ?? 0, fromPlayers));
    }
    const radiantKills = kills.get(2) ?? 0;
    const direKills = kills.get(3) ?? 0;
    if (radiantKills >= 2 && direKills < 2) return 2;
    if (direKills >= 2 && radiantKills < 2) return 3;

    // Towers: a tier-1 tower down ends the game; the server keeps it flagged
    // `destroyed` for the post-game screen.
    const lostTower = new Set<number>();
    for (const b of raw.buildings ?? []) {
      if (
        (b.type ?? 0) === 0 &&
        b.destroyed &&
        (b.team === 2 || b.team === 3)
      ) {
        lostTower.add(b.team);
      }
    }
    if (lostTower.has(2) && !lostTower.has(3)) return 3;
    if (lostTower.has(3) && !lostTower.has(2)) return 2;

    // The server itself says the game is over (post game / disconnect):
    // whoever leads on kills won; a leaver or a "gg" leaves it 1–0 or 0–0.
    const state = raw.match?.game_state ?? 0;
    if (opts.gameOver || state === 6 || state === 7) {
      if (radiantKills > direKills) return 2;
      if (direKills > radiantKills) return 3;
    }
    return null;
  }

  /** One-line digest of a snapshot for the log: state, time, kills, heroes, destroyed towers. */
  describe(raw: RealtimeStatsRaw): string {
    const teams = (raw.teams ?? [])
      .map((t) => {
        const players = (t.players ?? [])
          .map(
            (p) =>
              `${pick(p, 'accountid', 'account_id') ?? '?'}:h${pick(p, 'heroid', 'hero_id') ?? '?'} k${pick(p, 'kill_count', 'kills') ?? '?'}/d${pick(p, 'death_count', 'deaths') ?? '?'} nw${pick(p, 'net_worth', 'networth') ?? '?'}`,
          )
          .join(' ');
        return `T${t.team_number ?? '?'} score=${t.score ?? '?'} [${players}]`;
      })
      .join(' | ');
    const destroyed = (raw.buildings ?? [])
      .filter((b) => b.destroyed)
      .map((b) => `T${b.team}/type${b.type}/tier${b.tier}/lane${b.lane}`)
      .join(',');
    return `state=${raw.match?.game_state ?? '?'} t=${raw.match?.game_time ?? '?'} ${teams} destroyed=[${destroyed}] buildings=${raw.buildings?.length ?? 0}`;
  }

  /**
   * Per-duel summary straight from the GC's signed-out match — the most
   * complete stats source we have, no Web API involved.
   */
  fromGcMatch(
    match: NonNullable<GcMatchDetails['match']>,
    participants: StatsParticipant[],
  ): DuelStats {
    const outcome = match.match_outcome ?? 0;
    const players: DuelStatsPlayer[] = participants.map((who) => {
      const acc = accountIdOf(who.steamId64);
      const p = (match.players ?? []).find((x) => x.account_id === acc);
      const isRadiant = p?.player_slot == null ? null : p.player_slot < 128;
      return {
        playerId: who.playerId,
        steamId64: who.steamId64,
        heroId: p?.hero_id ?? null,
        kills: p?.kills ?? null,
        deaths: p?.deaths ?? null,
        assists: p?.assists ?? null,
        lastHits: p?.last_hits ?? null,
        denies: p?.denies ?? null,
        netWorth: p?.net_worth ?? p?.gold ?? null,
        level: p?.level ?? null,
        isRadiant,
        win:
          isRadiant == null || (outcome !== 2 && outcome !== 3)
            ? null
            : isRadiant === (outcome === 2),
      };
    });
    return { durationSeconds: match.duration ?? null, players };
  }

  /**
   * Final outcome of a finished match by id (`GetMatchDetails`), used when the
   * GC lobby vanished before POSTGAME reached us. Returns Valve's
   * `EMatchOutcome` (2 Radiant, 3 Dire) or null when Valve has nothing yet.
   */
  async fetchMatchOutcome(matchId: string): Promise<number | null> {
    const match = await this.fetchMatchDetails(matchId);
    return match ? this.outcomeOf(match) : null;
  }

  /**
   * The end data Valve publishes for a finished match (`GetMatchDetails`):
   * winner, duration, per-player stats. Lobby games show up a few minutes
   * after they end. Null when Valve has nothing (yet) or the key is missing.
   */
  async fetchMatchDetails(matchId: string): Promise<WebApiMatch | null> {
    const key = process.env.STEAM_API_KEY?.trim();
    if (!key) return null;
    try {
      const res = await firstValueFrom(
        this.http.get<{ result?: Partial<WebApiMatch> & { error?: string } }>(
          MATCH_DETAILS_URL,
          {
            params: { key, match_id: matchId },
            timeout: 10_000,
            validateStatus: () => true,
          },
        ),
      );
      const result = res.data?.result;
      if (
        res.status !== 200 ||
        !result ||
        typeof result.radiant_win !== 'boolean'
      ) {
        this.logger.warn(
          `GetMatchDetails(${matchId}): ${res.status} ${result?.error ?? 'no radiant_win'}`,
        );
        return null;
      }
      const match: WebApiMatch = {
        radiant_win: result.radiant_win,
        duration: result.duration,
        players: result.players,
      };
      this.logger.log(
        `GetMatchDetails(${matchId}) ✅ ${this.describeWebApi(match)}`,
      );
      return match;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`GetMatchDetails(${matchId}) failed: ${message}`);
      return null;
    }
  }

  /** `EMatchOutcome` of a Web API match: 2 Radiant, 3 Dire. */
  outcomeOf(match: WebApiMatch): number {
    return match.radiant_win ? 2 : 3;
  }

  /** One-line digest of a Web API match for the log: winner, duration, every player's line. */
  describeWebApi(match: WebApiMatch): string {
    const players = (match.players ?? [])
      .map(
        (p) =>
          `${pick(p, 'account_id') ?? '?'}:slot${pick(p, 'player_slot') ?? '?'} h${pick(p, 'hero_id') ?? '?'} k${pick(p, 'kills') ?? '?'}/d${pick(p, 'deaths') ?? '?'}/a${pick(p, 'assists') ?? '?'} lh${pick(p, 'last_hits') ?? '?'} nw${pick(p, 'net_worth', 'gold') ?? '?'} lvl${pick(p, 'level') ?? '?'} leaver${pick(p, 'leaver_status') ?? '?'}`,
      )
      .join(' | ');
    return `winner=${match.radiant_win ? 'radiant' : 'dire'} (outcome=${this.outcomeOf(match)}) duration=${match.duration ?? '?'}s players=${match.players?.length ?? 0} [${players}]`;
  }

  /**
   * One Web API match → what a duel needs from it: the winner, the heroes
   * actually played (for the random-hero rule) and the per-player stats.
   * Players Valve anonymised are kept with empty stats.
   */
  fromWebApiMatch(
    match: WebApiMatch,
    participants: StatsParticipant[],
  ): WebApiResult {
    const outcome = this.outcomeOf(match);
    const players: DuelStatsPlayer[] = participants.map((who) => {
      const acc = accountIdOf(who.steamId64);
      const p = (match.players ?? []).find(
        (x) => pick(x, 'account_id') === acc,
      );
      const slot = p ? pick(p, 'player_slot') : null;
      const isRadiant = slot == null ? null : slot < 128;
      return {
        playerId: who.playerId,
        steamId64: who.steamId64,
        heroId: p ? pick(p, 'hero_id') : null,
        kills: p ? pick(p, 'kills') : null,
        deaths: p ? pick(p, 'deaths') : null,
        assists: p ? pick(p, 'assists') : null,
        lastHits: p ? pick(p, 'last_hits') : null,
        denies: p ? pick(p, 'denies') : null,
        netWorth: p ? pick(p, 'net_worth', 'gold') : null,
        level: p ? pick(p, 'level') : null,
        isRadiant,
        win: isRadiant == null ? null : isRadiant === (outcome === 2),
      };
    });
    const heroesPlayed = players
      .filter(
        (p): p is DuelStatsPlayer & { playerId: string; heroId: number } =>
          !!p.playerId && p.heroId != null && p.heroId > 0,
      )
      .map((p) => ({ playerId: p.playerId, heroId: p.heroId }));
    return {
      outcome,
      heroesPlayed,
      stats: { durationSeconds: match.duration ?? null, players },
    };
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
