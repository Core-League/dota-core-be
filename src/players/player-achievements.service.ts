import { Injectable, NotFoundException } from '@nestjs/common';
import {
  derivePlayoffPlacementIds,
  type PlayoffPlace,
} from '../playoff/playoff-placements';
import { TournamentFormat } from './player.entity';
import {
  PlayerAchievementDto,
  PlayerAchievementKind as Kind,
  PlayerAchievementsDto,
  PlatformAchievementDto,
  PlatformAchievementHolderDto,
  PlatformAchievementsDto,
} from './dto/player-achievements.dto';
import {
  PlayerAchievementsRepository,
  type AchievementPlayerRow,
  type ParticipantRow,
  type PlacementSeriesWithTournamentRow,
  type PlayerMapResultRow,
  type PlayerTeamCreditRow,
} from './player-achievements.repository';

interface TournamentRef {
  id: string;
  name: string;
}

/** A trophy as tallied for one player before it is turned into a DTO. */
interface Tally {
  count: number;
  value: number | null;
  tournaments: TournamentRef[];
}

/** playerId → kind → tally */
type Board = Map<string, Map<Kind, Tally>>;

interface Snapshot {
  generatedAt: string;
  players: Map<string, AchievementPlayerRow>;
  board: Board;
}

/** A podium place one team earned in one decided tournament. */
interface TournamentPlacement extends TournamentRef {
  place: PlayoffPlace;
  teamId: string;
}

/** One player's record inside one tournament, from the roster-credited maps. */
interface TournamentRecord extends TournamentRef {
  played: number;
  won: number;
  qualificationPlayed: number;
  qualificationWon: number;
}

/** Everything derived from one player's participant lines. */
interface ParticipantStats {
  maps: number;
  kills: number;
  deaths: number;
  assists: number;
  radiantMaps: number;
  heroMaps: Map<number, number>;
  heavyKillMaps: number;
  maxKills: number;
  heavyAssistMaps: number;
  maxAssists: number;
  deathlessWins: number;
  feederMaps: number;
  maxDeaths: number;
  longestWinStreak: number;
  longestLossStreak: number;
  currentWinStreak: number;
  currentLossStreak: number;
  teammates: Set<string>;
}

/** Display order of the board and of a profile — the enum's declaration order. */
export const ACHIEVEMENT_KIND_ORDER: readonly Kind[] = Object.values(Kind);

const PLACEMENT_KINDS: Record<PlayoffPlace, Kind> = {
  1: Kind.TOURNAMENT_FIRST_PLACE,
  2: Kind.TOURNAMENT_SECOND_PLACE,
  3: Kind.TOURNAMENT_THIRD_PLACE,
};

/** Results arrive a few times a day; recomputing per profile view would be waste. */
const SNAPSHOT_TTL_MS = 60_000;

// Thresholds — kept together so tuning the game is one edit.
const FLAWLESS_MIN_MAPS = 3;
const PERFECT_QUALIFICATION_MIN_MAPS = 3;
const MAPS_MILESTONE_SMALL = 25;
const MAPS_MILESTONE_LARGE = 100;
const TOURNAMENTS_MILESTONE = 5;
const WIN_STREAK_SMALL = 5;
const WIN_STREAK_LARGE = 10;
const LOSS_STREAK = 5;
const WINRATE_MIN_MAPS = 10;
const HEAVY_KILLS = 20;
const HEAVY_ASSISTS = 25;
const DEATHLESS_MIN_IMPACT = 5;
const FEEDER_DEATHS = 15;
const HERO_LOYALIST_MAPS = 10;
const HERO_COLLECTOR_HEROES = 15;
const SIDE_MIN_MAPS = 10;
const SIDE_SHARE_PERCENT = 70;
const SQUAD_TEAMMATES = 10;

/**
 * Trophies for every player, computed from our own records and never
 * persisted. One snapshot serves both the profile (`getForPlayer`) and the
 * analytics board (`getPlatform`), so the two can never disagree.
 *
 * Rules, by family:
 * - Podium: placements come from decided playoffs via `derivePlayoffPlacementIds`;
 *   a player is credited through a team they played for in that tournament or
 *   whose current main roster / captain they are (the match-stats rule).
 * - Records ("MOST_…", "BEST_…", "HIGHEST_…"): the platform maximum, shared by
 *   everyone tied at the top; a zero never wins.
 * - Milestones and feats: thresholds on roster-credited maps (played / won) or
 *   on the player's own participant lines (kills, deaths, assists, hero, side,
 *   streaks in submission order).
 * - Community: facts on the player row (captaincy, verification, linked
 *   accounts, LAN readiness, paid donations).
 */
@Injectable()
export class PlayerAchievementsService {
  private snapshot: { expiresAt: number; promise: Promise<Snapshot> } | null =
    null;

  constructor(private readonly repo: PlayerAchievementsRepository) {}

  /** One profile's trophies, in display order. */
  async getForPlayer(id: string): Promise<PlayerAchievementsDto> {
    const snapshot = await this.getSnapshot();
    if (!snapshot.players.has(id)) {
      throw new NotFoundException('Гравця не знайдено');
    }
    const own = snapshot.board.get(id);
    const achievements: PlayerAchievementDto[] = [];
    for (const kind of ACHIEVEMENT_KIND_ORDER) {
      const tally = own?.get(kind);
      if (tally) achievements.push({ kind, ...tally });
    }
    return { achievements };
  }

  /**
   * Every trophy kind with everyone who holds it — the analytics board. Kinds
   * nobody has earned yet are returned with an empty holder list so the board
   * always shows the full catalog.
   */
  async getPlatform(): Promise<PlatformAchievementsDto> {
    const snapshot = await this.getSnapshot();

    const byKind = new Map<Kind, PlatformAchievementHolderDto[]>();
    for (const [playerId, tallies] of snapshot.board) {
      const player = snapshot.players.get(playerId);
      if (!player) continue;
      for (const [kind, tally] of tallies) {
        const holders = byKind.get(kind) ?? [];
        holders.push({
          playerId,
          discordName: player.discordName,
          discordUsername: player.discordUsername,
          avatarUrl: player.avatarUrl,
          count: tally.count,
          value: tally.value,
        });
        byKind.set(kind, holders);
      }
    }

    const achievements: PlatformAchievementDto[] = ACHIEVEMENT_KIND_ORDER.map(
      (kind) => {
        const holders = byKind.get(kind) ?? [];
        holders.sort(
          (a, b) =>
            b.count - a.count ||
            (b.value ?? 0) - (a.value ?? 0) ||
            (a.discordName ?? '').localeCompare(b.discordName ?? '', 'uk'),
        );
        return { kind, holders };
      },
    );

    return { generatedAt: snapshot.generatedAt, achievements };
  }

  // ─── Snapshot ──────────────────────────────────────────────────────────────

  private getSnapshot(): Promise<Snapshot> {
    const now = Date.now();
    if (this.snapshot && this.snapshot.expiresAt > now) {
      return this.snapshot.promise;
    }
    const promise = this.buildSnapshot().catch((error: unknown) => {
      this.snapshot = null; // don't cache a failure
      throw error;
    });
    this.snapshot = { expiresAt: now + SNAPSHOT_TTL_MS, promise };
    return promise;
  }

  private async buildSnapshot(): Promise<Snapshot> {
    const [
      series,
      credits,
      mapResults,
      participants,
      players,
      points,
      donations,
    ] = await Promise.all([
      this.repo.findDecidedPlayoffSeries(),
      this.repo.findAllTeamCredits(),
      this.repo.findAllMapResults(),
      this.repo.findAllParticipants(),
      this.repo.findAllPlayers(),
      this.repo.findTournamentPointsTotals(),
      this.repo.findPaidDonations(),
    ]);

    const playersById = new Map(players.map((p) => [p.id, p]));
    const board: Board = new Map();

    /** Sets a one-off trophy (count 1) with an optional number behind it. */
    const set = (playerId: string, kind: Kind, value: number | null = null) => {
      if (!playersById.has(playerId)) return;
      const own = board.get(playerId) ?? new Map<Kind, Tally>();
      own.set(kind, { count: 1, value, tournaments: [] });
      board.set(playerId, own);
    };

    /** Counts one more occurrence: a tournament for placements, a map for per-map feats. */
    const bump = (
      playerId: string,
      kind: Kind,
      occurrence: { tournament?: TournamentRef; value?: number },
    ) => {
      if (!playersById.has(playerId)) return;
      const own = board.get(playerId) ?? new Map<Kind, Tally>();
      const tally = own.get(kind) ?? { count: 0, value: null, tournaments: [] };
      tally.count += 1;
      if (occurrence.tournament) tally.tournaments.push(occurrence.tournament);
      if (occurrence.value != null) {
        tally.value = Math.max(tally.value ?? 0, occurrence.value);
      }
      own.set(kind, tally);
      board.set(playerId, own);
    };

    /** Platform record: the maximum of `entries`, shared by every tie; nothing below `min`. */
    const record = (
      kind: Kind,
      entries: Iterable<[string, number]>,
      min = 1,
    ) => {
      const list = [...entries];
      const max = list.reduce((m, [, v]) => Math.max(m, v), 0);
      if (max < min) return;
      for (const [playerId, v] of list) if (v === max) set(playerId, kind, max);
    };

    this.awardPodium(series, credits, mapResults, bump);
    this.awardMapMilestones(mapResults, set, record);
    this.awardParticipantFeats(participants, set, bump, record);

    // Community & ratings — straight from the player rows.
    record(
      Kind.HIGHEST_RATING,
      players
        .filter((p) => p.verifiedAt != null && p.rating > 0)
        .map((p): [string, number] => [p.id, p.rating]),
    );
    for (const p of players) {
      if (p.isCaptain) set(p.id, Kind.TEAM_CAPTAIN);
      if (p.verifiedAt != null) set(p.id, Kind.VERIFIED_PLAYER);
      if (p.steamId && p.discordId && p.telegramId) {
        set(p.id, Kind.FULLY_CONNECTED);
      }
      if (
        p.wantToPlay?.includes(TournamentFormat.LAN) &&
        (p.lanCities?.length ?? 0) > 0
      ) {
        set(p.id, Kind.LAN_READY, p.lanCities?.length ?? 0);
      }
    }

    record(
      Kind.MOST_TOURNAMENT_POINTS,
      points.map((r): [string, number] => [r.playerId, r.points]),
    );

    for (const d of donations) {
      if (d.donations <= 0 || !playersById.has(d.playerId)) continue;
      const own = board.get(d.playerId) ?? new Map<Kind, Tally>();
      own.set(Kind.PATRON, {
        count: d.donations,
        value: d.amountPaid,
        tournaments: [],
      });
      board.set(d.playerId, own);
    }

    return {
      generatedAt: new Date().toISOString(),
      players: playersById,
      board,
    };
  }

  // ─── Podium ────────────────────────────────────────────────────────────────

  private awardPodium(
    series: PlacementSeriesWithTournamentRow[],
    credits: PlayerTeamCreditRow[],
    mapResults: PlayerMapResultRow[],
    bump: (
      playerId: string,
      kind: Kind,
      occurrence: { tournament?: TournamentRef; value?: number },
    ) => void,
  ): void {
    const credited = this.buildCreditIndex(credits);
    const perTournament = this.groupByTournament(mapResults);

    // Teams that lost any series inside a decided playoff — the lower-bracket route.
    const seriesLosers = new Map<string, Set<string>>();
    for (const s of series) {
      if (!s.seriesWinnerId) continue;
      const loser =
        s.teamAId === s.seriesWinnerId
          ? s.teamBId
          : s.teamBId === s.seriesWinnerId
            ? s.teamAId
            : null;
      if (!loser) continue;
      const set = seriesLosers.get(s.tournamentId) ?? new Set<string>();
      set.add(loser);
      seriesLosers.set(s.tournamentId, set);
    }

    for (const p of this.derivePlacements(series)) {
      const tournament: TournamentRef = { id: p.id, name: p.name };
      for (const playerId of credited(p.id, p.teamId)) {
        bump(playerId, PLACEMENT_KINDS[p.place], { tournament });
        if (p.place !== 1) continue;

        const own = perTournament.get(playerId)?.get(p.id);
        if (own && own.played >= FLAWLESS_MIN_MAPS && own.won === own.played) {
          bump(playerId, Kind.FLAWLESS_CHAMPION, { tournament });
        }
        if (seriesLosers.get(p.id)?.has(p.teamId)) {
          bump(playerId, Kind.LOWER_BRACKET_CHAMPION, { tournament });
        }
      }
    }

    for (const [playerId, byTournament] of perTournament) {
      for (const t of byTournament.values()) {
        if (
          t.qualificationPlayed >= PERFECT_QUALIFICATION_MIN_MAPS &&
          t.qualificationWon === t.qualificationPlayed
        ) {
          bump(playerId, Kind.PERFECT_QUALIFICATION, {
            tournament: { id: t.id, name: t.name },
          });
        }
      }
    }
  }

  /** Podium places of every decided tournament, grouping the flat series rows per tournament first. */
  private derivePlacements(
    series: PlacementSeriesWithTournamentRow[],
  ): TournamentPlacement[] {
    const byTournament = new Map<string, PlacementSeriesWithTournamentRow[]>();
    for (const row of series) {
      const rows = byTournament.get(row.tournamentId) ?? [];
      rows.push(row);
      byTournament.set(row.tournamentId, rows);
    }

    const placements: TournamentPlacement[] = [];
    for (const [tournamentId, rows] of byTournament) {
      const { tournamentName, bracketType, hasThirdPlaceMatch } = rows[0];
      const ids = derivePlayoffPlacementIds(rows, {
        bracketType,
        hasThirdPlaceMatch,
      });
      for (const p of ids) {
        placements.push({
          id: tournamentId,
          name: tournamentName,
          place: p.place,
          teamId: p.teamId,
        });
      }
    }
    return placements;
  }

  /**
   * Turns credit rows into a lookup "who is credited for team X in tournament
   * Y": everyone who played for that team there plus its current main roster
   * and captain.
   */
  private buildCreditIndex(
    credits: PlayerTeamCreditRow[],
  ): (tournamentId: string, teamId: string) => Set<string> {
    const current = new Map<string, Set<string>>();
    const played = new Map<string, Set<string>>();
    const add = (map: Map<string, Set<string>>, key: string, id: string) => {
      const set = map.get(key) ?? new Set<string>();
      set.add(id);
      map.set(key, set);
    };
    for (const c of credits) {
      if (c.tournamentId == null) add(current, c.teamId, c.playerId);
      else add(played, `${c.tournamentId}|${c.teamId}`, c.playerId);
    }
    return (tournamentId, teamId) =>
      new Set<string>([
        ...(current.get(teamId) ?? []),
        ...(played.get(`${tournamentId}|${teamId}`) ?? []),
      ]);
  }

  /** playerId → tournamentId → maps played / won there (all stages and qualification only). */
  private groupByTournament(
    mapResults: PlayerMapResultRow[],
  ): Map<string, Map<string, TournamentRecord>> {
    const out = new Map<string, Map<string, TournamentRecord>>();
    for (const r of mapResults) {
      const byTournament =
        out.get(r.playerId) ?? new Map<string, TournamentRecord>();
      const t: TournamentRecord = byTournament.get(r.tournamentId) ?? {
        id: r.tournamentId,
        name: r.tournamentName,
        played: 0,
        won: 0,
        qualificationPlayed: 0,
        qualificationWon: 0,
      };
      t.played += 1;
      if (r.won) t.won += 1;
      if (r.stage === 'qualification') {
        t.qualificationPlayed += 1;
        if (r.won) t.qualificationWon += 1;
      }
      byTournament.set(r.tournamentId, t);
      out.set(r.playerId, byTournament);
    }
    return out;
  }

  // ─── Maps: milestones & records ────────────────────────────────────────────

  private awardMapMilestones(
    mapResults: PlayerMapResultRow[],
    set: (playerId: string, kind: Kind, value?: number | null) => void,
    record: (
      kind: Kind,
      entries: Iterable<[string, number]>,
      min?: number,
    ) => void,
  ): void {
    const counts = new Map<
      string,
      { played: number; won: number; tournaments: Set<string> }
    >();
    for (const r of mapResults) {
      const c = counts.get(r.playerId) ?? {
        played: 0,
        won: 0,
        tournaments: new Set<string>(),
      };
      c.played += 1;
      if (r.won) c.won += 1;
      c.tournaments.add(r.tournamentId);
      counts.set(r.playerId, c);
    }

    for (const [playerId, c] of counts) {
      if (c.played >= 1) set(playerId, Kind.FIRST_MATCH, c.played);
      if (c.played >= MAPS_MILESTONE_SMALL)
        set(playerId, Kind.MAPS_25, c.played);
      if (c.played >= MAPS_MILESTONE_LARGE)
        set(playerId, Kind.MAPS_100, c.played);
      if (c.tournaments.size >= TOURNAMENTS_MILESTONE) {
        set(playerId, Kind.TOURNAMENTS_5, c.tournaments.size);
      }
    }

    const entries = [...counts.entries()];
    record(
      Kind.MOST_MATCHES_PLAYED,
      entries.map(([id, c]): [string, number] => [id, c.played]),
    );
    record(
      Kind.MOST_MATCHES_WON,
      entries.map(([id, c]): [string, number] => [id, c.won]),
    );
    record(
      Kind.MOST_MATCHES_LOST,
      entries.map(([id, c]): [string, number] => [id, c.played - c.won]),
    );
    record(
      Kind.BEST_WINRATE,
      entries
        .filter(([, c]) => c.played >= WINRATE_MIN_MAPS)
        .map(([id, c]): [string, number] => [
          id,
          Math.round((c.won * 100) / c.played),
        ]),
    );
  }

  // ─── Participant lines: combat, heroes, sides, streaks, teammates ─────────

  private awardParticipantFeats(
    participants: ParticipantRow[],
    set: (playerId: string, kind: Kind, value?: number | null) => void,
    bump: (
      playerId: string,
      kind: Kind,
      occurrence: { tournament?: TournamentRef; value?: number },
    ) => void,
    record: (
      kind: Kind,
      entries: Iterable<[string, number]>,
      min?: number,
    ) => void,
  ): void {
    const stats = new Map<string, ParticipantStats>();
    const statsOf = (playerId: string): ParticipantStats => {
      const existing = stats.get(playerId);
      if (existing) return existing;
      const created: ParticipantStats = {
        maps: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        radiantMaps: 0,
        heroMaps: new Map(),
        heavyKillMaps: 0,
        maxKills: 0,
        heavyAssistMaps: 0,
        maxAssists: 0,
        deathlessWins: 0,
        feederMaps: 0,
        maxDeaths: 0,
        longestWinStreak: 0,
        longestLossStreak: 0,
        currentWinStreak: 0,
        currentLossStreak: 0,
        teammates: new Set(),
      };
      stats.set(playerId, created);
      return created;
    };

    // Who shared a side in each map — for the "played with N teammates" trophy.
    const sides = new Map<string, string[]>();
    for (const row of participants) {
      if (!row.teamId) continue;
      const key = `${row.stage}|${row.matchId}|${row.teamId}`;
      const list = sides.get(key) ?? [];
      list.push(row.playerId);
      sides.set(key, list);
    }
    for (const list of sides.values()) {
      for (const playerId of list) {
        const s = statsOf(playerId);
        for (const other of list)
          if (other !== playerId) s.teammates.add(other);
      }
    }

    // Rows are ordered oldest → newest, so streaks are just a running count.
    for (const row of participants) {
      const s = statsOf(row.playerId);
      const kills = row.kills ?? 0;
      const deaths = row.deaths ?? 0;
      const assists = row.assists ?? 0;

      s.maps += 1;
      s.kills += kills;
      s.deaths += deaths;
      s.assists += assists;
      if (row.isRadiant) s.radiantMaps += 1;
      if (row.heroId != null) {
        s.heroMaps.set(row.heroId, (s.heroMaps.get(row.heroId) ?? 0) + 1);
      }

      if (kills >= HEAVY_KILLS) s.heavyKillMaps += 1;
      s.maxKills = Math.max(s.maxKills, kills);
      if (assists >= HEAVY_ASSISTS) s.heavyAssistMaps += 1;
      s.maxAssists = Math.max(s.maxAssists, assists);
      if (
        row.won &&
        row.deaths === 0 &&
        kills + assists >= DEATHLESS_MIN_IMPACT
      ) {
        s.deathlessWins += 1;
      }
      if (deaths >= FEEDER_DEATHS) s.feederMaps += 1;
      s.maxDeaths = Math.max(s.maxDeaths, deaths);

      if (row.won) {
        s.currentWinStreak += 1;
        s.currentLossStreak = 0;
      } else {
        s.currentLossStreak += 1;
        s.currentWinStreak = 0;
      }
      s.longestWinStreak = Math.max(s.longestWinStreak, s.currentWinStreak);
      s.longestLossStreak = Math.max(s.longestLossStreak, s.currentLossStreak);
    }

    for (const [playerId, s] of stats) {
      if (s.heavyKillMaps > 0) {
        for (let i = 0; i < s.heavyKillMaps; i++) {
          bump(playerId, Kind.KILLS_20_IN_MAP, { value: s.maxKills });
        }
      }
      if (s.heavyAssistMaps > 0) {
        for (let i = 0; i < s.heavyAssistMaps; i++) {
          bump(playerId, Kind.ASSISTS_25_IN_MAP, { value: s.maxAssists });
        }
      }
      for (let i = 0; i < s.deathlessWins; i++) {
        bump(playerId, Kind.DEATHLESS_WIN, {});
      }
      for (let i = 0; i < s.feederMaps; i++) {
        bump(playerId, Kind.FEEDER_15_DEATHS, { value: s.maxDeaths });
      }

      if (s.longestWinStreak >= WIN_STREAK_SMALL) {
        set(playerId, Kind.WIN_STREAK_5, s.longestWinStreak);
      }
      if (s.longestWinStreak >= WIN_STREAK_LARGE) {
        set(playerId, Kind.WIN_STREAK_10, s.longestWinStreak);
      }
      if (s.longestLossStreak >= LOSS_STREAK) {
        set(playerId, Kind.LOSS_STREAK_5, s.longestLossStreak);
      }

      const favouriteHeroMaps = Math.max(0, ...s.heroMaps.values());
      if (favouriteHeroMaps >= HERO_LOYALIST_MAPS) {
        set(playerId, Kind.HERO_LOYALIST, favouriteHeroMaps);
      }
      if (s.heroMaps.size >= HERO_COLLECTOR_HEROES) {
        set(playerId, Kind.HERO_COLLECTOR, s.heroMaps.size);
      }

      if (s.maps >= SIDE_MIN_MAPS) {
        const radiantShare = Math.round((s.radiantMaps * 100) / s.maps);
        if (radiantShare >= SIDE_SHARE_PERCENT) {
          set(playerId, Kind.RADIANT_CHILD, radiantShare);
        }
        if (100 - radiantShare >= SIDE_SHARE_PERCENT) {
          set(playerId, Kind.DIRE_DEVOTEE, 100 - radiantShare);
        }
      }

      if (s.teammates.size >= SQUAD_TEAMMATES) {
        set(playerId, Kind.SQUAD_SOCIALITE, s.teammates.size);
      }
    }

    const entries = [...stats.entries()];
    record(
      Kind.MOST_KILLS,
      entries.map(([id, s]): [string, number] => [id, s.kills]),
    );
    record(
      Kind.MOST_ASSISTS,
      entries.map(([id, s]): [string, number] => [id, s.assists]),
    );
    record(
      Kind.MOST_DEATHS,
      entries.map(([id, s]): [string, number] => [id, s.deaths]),
    );
  }
}
