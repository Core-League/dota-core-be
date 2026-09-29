import { Injectable } from '@nestjs/common';
import { toPlayerRankDto } from '../players/dto/player-rank.dto';
import { PlayerAchievementKind as Kind } from '../players/dto/player-achievements.dto';
import { PlayerAchievementsService } from '../players/player-achievements.service';
import { PlayerAchievementsRepository } from '../players/player-achievements.repository';
import {
  LeaderboardDto,
  LeaderboardPlayerDto,
  LeaderboardPodiumDto,
  LeaderboardWeightsDto,
} from './dto/leaderboard.dto';

/** Boards are read far more often than results change; one build per minute is plenty. */
const BOARD_TTL_MS = 60_000;

/**
 * What each statistic is worth. Qualification points already reward map
 * results (100 per win, 40 per loss), so they carry a small weight to avoid
 * counting the same map three times.
 */
const WEIGHTS: Readonly<LeaderboardWeightsDto> = {
  firstPlace: 100,
  secondPlace: 60,
  thirdPlace: 35,
  achievement: 10,
  mapWon: 3,
  mapPlayed: 1,
  tournamentPoint: 0.05,
};

/** Scored through `podium`, not as generic achievements. */
const PLACEMENT_KINDS: ReadonlySet<Kind> = new Set([
  Kind.TOURNAMENT_FIRST_PLACE,
  Kind.TOURNAMENT_SECOND_PLACE,
  Kind.TOURNAMENT_THIRD_PLACE,
]);

/** Consolation trophies — shown on profiles, never worth points. */
const JOKE_KINDS: ReadonlySet<Kind> = new Set([
  Kind.MOST_MATCHES_LOST,
  Kind.MOST_DEATHS,
  Kind.FEEDER_15_DEATHS,
  Kind.LOSS_STREAK_5,
]);

/** Per-player accumulator before scoring. */
interface Line {
  achievements: Set<Kind>;
  podium: LeaderboardPodiumDto;
  maps: number;
  wins: number;
  tournaments: Set<string>;
  tournamentPoints: number;
  kills: number;
  deaths: number;
  assists: number;
}

/**
 * The platform leaderboard: every player ranked by a composite of their
 * podiums, achievements, map record and qualification points. Built from the
 * same loaders and trophy snapshot the profiles use, so a row never disagrees
 * with the player's own page.
 */
@Injectable()
export class LeaderboardService {
  private board: {
    expiresAt: number;
    promise: Promise<LeaderboardDto>;
  } | null = null;

  constructor(
    private readonly repo: PlayerAchievementsRepository,
    private readonly achievements: PlayerAchievementsService,
  ) {}

  getBoard(): Promise<LeaderboardDto> {
    const now = Date.now();
    if (this.board && this.board.expiresAt > now) {
      return this.board.promise;
    }
    const promise = this.build().catch((error: unknown) => {
      this.board = null; // don't cache a failure
      throw error;
    });
    this.board = { expiresAt: now + BOARD_TTL_MS, promise };
    return promise;
  }

  private async build(): Promise<LeaderboardDto> {
    const [players, mapResults, participants, points, platform] =
      await Promise.all([
        this.repo.findAllPlayers(),
        this.repo.findAllMapResults(),
        this.repo.findAllParticipants(),
        this.repo.findTournamentPointsTotals(),
        this.achievements.getPlatform(),
      ]);

    const lines = new Map<string, Line>();
    const lineOf = (playerId: string): Line => {
      const existing = lines.get(playerId);
      if (existing) return existing;
      const created: Line = {
        achievements: new Set(),
        podium: { first: 0, second: 0, third: 0 },
        maps: 0,
        wins: 0,
        tournaments: new Set(),
        tournamentPoints: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
      };
      lines.set(playerId, created);
      return created;
    };

    for (const r of mapResults) {
      const line = lineOf(r.playerId);
      line.maps += 1;
      if (r.won) line.wins += 1;
      line.tournaments.add(r.tournamentId);
    }

    for (const p of participants) {
      const line = lineOf(p.playerId);
      line.kills += p.kills ?? 0;
      line.deaths += p.deaths ?? 0;
      line.assists += p.assists ?? 0;
    }

    for (const p of points) {
      lineOf(p.playerId).tournamentPoints += p.points;
    }

    for (const { kind, holders } of platform.achievements) {
      for (const holder of holders) {
        const line = lineOf(holder.playerId);
        line.achievements.add(kind);
        if (kind === Kind.TOURNAMENT_FIRST_PLACE) {
          line.podium.first += holder.count;
        } else if (kind === Kind.TOURNAMENT_SECOND_PLACE) {
          line.podium.second += holder.count;
        } else if (kind === Kind.TOURNAMENT_THIRD_PLACE) {
          line.podium.third += holder.count;
        }
      }
    }

    const rows: LeaderboardPlayerDto[] = [];
    for (const player of players) {
      const line = lines.get(player.id);
      if (!line || (line.maps === 0 && line.achievements.size === 0)) continue;

      rows.push({
        position: 0,
        playerId: player.id,
        discordName: player.discordName,
        discordUsername: player.discordUsername,
        avatarUrl: player.avatarUrl,
        verified: player.verifiedAt != null,
        rating: player.rating,
        rank: toPlayerRankDto(player.rating),
        score: this.score(line),
        achievements: line.achievements.size,
        podium: line.podium,
        maps: line.maps,
        wins: line.wins,
        losses: line.maps - line.wins,
        winrate:
          line.maps > 0 ? Math.round((line.wins * 100) / line.maps) : null,
        tournaments: line.tournaments.size,
        tournamentPoints: line.tournamentPoints,
        kills: line.kills,
        deaths: line.deaths,
        assists: line.assists,
      });
    }

    rows.sort(
      (a, b) =>
        b.score - a.score ||
        b.wins - a.wins ||
        (b.winrate ?? 0) - (a.winrate ?? 0) ||
        b.achievements - a.achievements ||
        (a.discordName ?? '').localeCompare(b.discordName ?? '', 'uk'),
    );
    rows.forEach((row, index) => {
      row.position = index + 1;
    });

    return {
      generatedAt: new Date().toISOString(),
      weights: { ...WEIGHTS },
      players: rows,
    };
  }

  private score(line: Line): number {
    let scoredAchievements = 0;
    for (const kind of line.achievements) {
      if (!PLACEMENT_KINDS.has(kind) && !JOKE_KINDS.has(kind)) {
        scoredAchievements += 1;
      }
    }
    const raw =
      line.podium.first * WEIGHTS.firstPlace +
      line.podium.second * WEIGHTS.secondPlace +
      line.podium.third * WEIGHTS.thirdPlace +
      scoredAchievements * WEIGHTS.achievement +
      line.wins * WEIGHTS.mapWon +
      line.maps * WEIGHTS.mapPlayed +
      line.tournamentPoints * WEIGHTS.tournamentPoint;
    return Math.round(raw);
  }
}
