import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Player, TournamentFormat } from './player.entity';
import { toPlayerRankDto } from './dto/player-rank.dto';
import { PlayerResponseDto } from './dto/player-response.dto';
import { getRoleColorByName } from '../user-roles/role.constants';
import { PlayersRepository } from './players.repository';
import {
  PlayerMatchStatsRepository,
  type PlayerMatchRow,
} from './player-match-stats.repository';
import {
  PlayerMatchStageStatsDto,
  PlayerMatchStatsDto,
} from './dto/player-match-stats.dto';
import {
  PlayerAchievementsRepository,
  type PlacementSeriesWithTournamentRow,
  type PlayerTeamCreditRow,
} from './player-achievements.repository';
import {
  PlayerAchievementDto,
  PlayerAchievementKind,
  PlayerAchievementsDto,
  PlayerAchievementTournamentDto,
} from './dto/player-achievements.dto';
import {
  derivePlayoffPlacementIds,
  type PlayoffPlace,
} from '../playoff/playoff-placements';
import { TeamsService } from '../teams/teams.service';
import { LocationsService } from '../locations/locations.service';
import {
  CityRoleSyncReport,
  DiscordBotService,
} from '../discord/discord-bot.service';

/** LAN events happen in Ukraine: city roles and `lanCities` validation use its catalog. */
const LAN_COUNTRY_CODE = 'UA';

@Injectable()
export class PlayersService {
  private readonly logger = new Logger(PlayersService.name);

  constructor(
    private readonly playersRepo: PlayersRepository,
    private readonly matchStatsRepo: PlayerMatchStatsRepository,
    private readonly achievementsRepo: PlayerAchievementsRepository,
    private readonly teamsService: TeamsService,
    private readonly locationsService: LocationsService,
    private readonly discord: DiscordBotService,
  ) {}

  private toResponse(player: Player): PlayerResponseDto {
    return {
      id: player.id,
      steamId: player.steamId ?? null,
      discordId: player.discordId ?? null,
      telegramId: player.telegramId ?? null,
      avatarUrl: player.avatarUrl ?? null,
      discordName: player.discordName ?? null,
      discordUsername: player.discordUsername ?? null,
      rating: player.rating,
      rank: toPlayerRankDto(player.rating),
      positions: player.positions ?? null,
      countryCode: player.countryCode ?? null,
      city: player.city ?? null,
      wantToPlay: player.wantToPlay ?? null,
      lanCities: player.lanCities ?? null,
      verifiedAt: player.verifiedAt ?? null,
      teamId: player.teamId ?? null,
      roles: (player.roles ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        isAdminRole: r.isAdminRole,
        color: getRoleColorByName(r.name) ?? '#64748B',
      })),
    };
  }

  create(payload: Partial<Player>): Promise<Player> {
    const entity = this.playersRepo.create(payload);
    return this.playersRepo.save(entity);
  }

  async findAll(): Promise<PlayerResponseDto[]> {
    const rows = await this.playersRepo.findAll();
    return rows.map((p) => this.toResponse(p));
  }

  async findOne(id: string): Promise<PlayerResponseDto> {
    const player = await this.playersRepo.findOneById(id);
    if (!player) {
      throw new NotFoundException('Гравця не знайдено');
    }
    return this.toResponse(player);
  }

  /** Record across this platform's tournaments; see PlayerMatchStatsRepository for the crediting rule. */
  async getMatchStats(id: string): Promise<PlayerMatchStatsDto> {
    const player = await this.playersRepo.findOneById(id);
    if (!player) {
      throw new NotFoundException('Гравця не знайдено');
    }

    const rows = await this.matchStatsRepo.findPlayedMaps(id);

    const stage = (name: PlayerMatchRow['stage']): PlayerMatchStageStatsDto => {
      const subset = rows.filter((r) => r.stage === name);
      const wins = subset.filter((r) => r.won).length;
      return { total: subset.length, wins, losses: subset.length - wins };
    };

    const qualification = stage('qualification');
    const playoff = stage('playoff');
    const total = qualification.total + playoff.total;
    const wins = qualification.wins + playoff.wins;

    return {
      total,
      wins,
      losses: total - wins,
      winrate: total > 0 ? Math.round((wins * 100) / total) : null,
      tournaments: new Set(rows.map((r) => r.tournamentId)).size,
      qualification,
      playoff,
    };
  }

  /**
   * Profile trophies, computed on request. Placements (1st–3rd) are read from
   * decided playoffs; the "most …" trophies compare the player with the
   * platform-wide maximum and are shared by everyone tied at the top. A zero
   * record never earns anything, so a fresh platform shows no trophies.
   */
  async getAchievements(id: string): Promise<PlayerAchievementsDto> {
    const player = await this.playersRepo.findOneById(id);
    if (!player) {
      throw new NotFoundException('Гравця не знайдено');
    }

    const [series, credits, matchRecord, ratingRecord] = await Promise.all([
      this.achievementsRepo.findDecidedPlayoffSeries(),
      this.achievementsRepo.findPlayerTeamCredits(id),
      this.achievementsRepo.findMatchRecord(id),
      this.achievementsRepo.findRatingRecord(id),
    ]);

    const achievements: PlayerAchievementDto[] = [];

    const placements = this.collectPlacements(series, credits);
    const placementKinds: Record<PlayoffPlace, PlayerAchievementKind> = {
      1: PlayerAchievementKind.TOURNAMENT_FIRST_PLACE,
      2: PlayerAchievementKind.TOURNAMENT_SECOND_PLACE,
      3: PlayerAchievementKind.TOURNAMENT_THIRD_PLACE,
    };
    for (const place of [1, 2, 3] as PlayoffPlace[]) {
      const tournaments = placements.get(place) ?? [];
      if (tournaments.length === 0) continue;
      achievements.push({
        kind: placementKinds[place],
        count: tournaments.length,
        value: null,
        tournaments,
      });
    }

    const record = (
      kind: PlayerAchievementKind,
      value: number | null,
      max: number | null,
    ) => {
      if (value == null || max == null || value <= 0 || value < max) return;
      achievements.push({ kind, count: 1, value, tournaments: [] });
    };
    record(
      PlayerAchievementKind.MOST_MATCHES_PLAYED,
      matchRecord.played,
      matchRecord.maxPlayed,
    );
    record(
      PlayerAchievementKind.MOST_MATCHES_WON,
      matchRecord.won,
      matchRecord.maxWon,
    );
    record(
      PlayerAchievementKind.MOST_MATCHES_LOST,
      matchRecord.lost,
      matchRecord.maxLost,
    );
    record(
      PlayerAchievementKind.HIGHEST_RATING,
      ratingRecord.rating,
      ratingRecord.maxRating,
    );

    return { achievements };
  }

  /**
   * Tournaments where a team the player is credited through finished 1st, 2nd
   * or 3rd. Series rows arrive for every decided playoff at once and are grouped
   * per tournament here, so placements are derived with the same pure function
   * the playoff page uses.
   */
  private collectPlacements(
    series: PlacementSeriesWithTournamentRow[],
    credits: PlayerTeamCreditRow[],
  ): Map<PlayoffPlace, PlayerAchievementTournamentDto[]> {
    const currentTeams = new Set(
      credits.filter((c) => c.tournamentId == null).map((c) => c.teamId),
    );
    const playedFor = new Map<string, Set<string>>();
    for (const c of credits) {
      if (c.tournamentId == null) continue;
      const set = playedFor.get(c.tournamentId) ?? new Set<string>();
      set.add(c.teamId);
      playedFor.set(c.tournamentId, set);
    }
    const isCredited = (tournamentId: string, teamId: string) =>
      currentTeams.has(teamId) ||
      (playedFor.get(tournamentId)?.has(teamId) ?? false);

    const byTournament = new Map<string, PlacementSeriesWithTournamentRow[]>();
    for (const row of series) {
      const rows = byTournament.get(row.tournamentId) ?? [];
      rows.push(row);
      byTournament.set(row.tournamentId, rows);
    }

    const result = new Map<PlayoffPlace, PlayerAchievementTournamentDto[]>();
    for (const [tournamentId, rows] of byTournament) {
      const { tournamentName, bracketType, hasThirdPlaceMatch } = rows[0];
      const ids = derivePlayoffPlacementIds(rows, {
        bracketType,
        hasThirdPlaceMatch,
      });
      for (const p of ids) {
        if (!isCredited(tournamentId, p.teamId)) continue;
        const list = result.get(p.place) ?? [];
        list.push({ id: tournamentId, name: tournamentName });
        result.set(p.place, list);
      }
    }
    return result;
  }

  async update(
    id: string,
    payload: Partial<Player>,
    options?: { actorHasAdminRole?: boolean },
  ): Promise<PlayerResponseDto> {
    const player = await this.playersRepo.findOneById(id);
    if (!player) {
      throw new NotFoundException('Гравця не знайдено');
    }
    if (
      player.verifiedAt != null &&
      Object.prototype.hasOwnProperty.call(payload, 'rating')
    ) {
      if (!options?.actorHasAdminRole) {
        throw new ForbiddenException(
          'Verified players cannot change their rating',
        );
      }
    }
    // Players may not unlink their own Steam account — only admins can clear steamId
    if (
      Object.prototype.hasOwnProperty.call(payload, 'steamId') &&
      !options?.actorHasAdminRole &&
      player.steamId != null &&
      (payload.steamId == null || payload.steamId === '')
    ) {
      throw new ForbiddenException('Players cannot unlink their Steam account');
    }
    // teamId is managed exclusively by TeamsService.syncPlayerTeamLinks — never accept it from outside
    const safePayload = { ...(payload as Record<string, unknown>) };
    delete safePayload['teamId'];
    delete safePayload['verifiedAt'];
    // Unique nullable columns must be null (not empty string) to satisfy the DB constraint
    if (safePayload['steamId'] === '') safePayload['steamId'] = null;
    if (safePayload['discordId'] === '') safePayload['discordId'] = null;
    await this.applyLocation(player, safePayload);
    await this.applyLanCities(player, safePayload);
    const prevCityRoles = PlayersService.cityRoleNames(player);
    Object.assign(player, safePayload);
    await this.playersRepo.save(player);
    if (
      'lanCities' in safePayload ||
      'city' in safePayload ||
      'countryCode' in safePayload
    ) {
      this.syncCityRoles(player, prevCityRoles);
    }
    const refreshed = await this.playersRepo.findOneById(id);
    if (!refreshed) {
      throw new NotFoundException('Гравця не знайдено');
    }
    return this.toResponse(refreshed);
  }

  /**
   * Location rules: the country must come from the allowed catalog (never
   * RU/BY/IR), a city only makes sense with a country, and changing the
   * country drops a city that was not re-sent alongside it.
   */
  private async applyLocation(
    player: Player,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const hasCountry = 'countryCode' in payload;
    const hasCity = 'city' in payload;
    if (!hasCountry && !hasCity) return;

    let nextCountry: string | null = player.countryCode ?? null;
    if (hasCountry) {
      const raw = payload['countryCode'];
      nextCountry =
        typeof raw === 'string' && raw.trim() !== ''
          ? LocationsService.normalizeCountryCode(raw)
          : null;
      if (nextCountry) {
        const country = await this.locationsService.findCountry(nextCountry);
        if (!country) {
          throw new BadRequestException(
            'Обрану країну неможливо вказати в профілі',
          );
        }
      }
      payload['countryCode'] = nextCountry;
    }

    let nextCity: string | null = player.city ?? null;
    if (hasCity) {
      const raw = payload['city'];
      nextCity =
        typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
    }
    if (!nextCountry) {
      nextCity = null;
    } else if (hasCountry && nextCountry !== player.countryCode && !hasCity) {
      nextCity = null;
    }
    payload['city'] = nextCity;
  }

  /**
   * Cities that become Discord roles for a player: the LAN cities plus the home
   * city from the location block when the player lives in Ukraine (the roles
   * exist for Ukrainian LAN events, so a foreign home city is left out).
   */
  static cityRoleNames(player: Player): string[] {
    const names = new Set<string>();
    for (const c of player.lanCities ?? []) {
      const name = c.trim();
      if (name) names.add(name);
    }
    const home = (player.city ?? '').trim();
    if (home && player.countryCode === LAN_COUNTRY_CODE) names.add(home);
    return [...names];
  }

  /**
   * Discord mirror of {@link cityRoleNames} (one yellow role per city).
   * Fire-and-forget: the save must not wait on Discord rate limits, and the bot
   * service already logs and swallows its own failures.
   */
  private syncCityRoles(player: Player, prevCityRoles: string[]): void {
    if (!player.discordId) return;
    void this.discord
      .syncCityRoles(
        player.discordId,
        PlayersService.cityRoleNames(player),
        prevCityRoles,
      )
      .catch((err: unknown) =>
        this.logger.warn(
          `City role sync failed for player ${player.id}`,
          err instanceof Error ? err.message : err,
        ),
      );
  }

  /**
   * Re-applies every city role (home + LAN) and reports what happened.
   * Idempotent (assigning a role the member already has is a no-op for Discord);
   * meant for the player to self-heal and for diagnosing bot permissions.
   */
  async resyncCityRoles(playerId: string): Promise<CityRoleSyncReport> {
    const player = await this.playersRepo.findOneById(playerId);
    if (!player) {
      throw new NotFoundException('Гравця не знайдено');
    }
    return this.discord.syncCityRoles(
      player.discordId ?? '',
      PlayersService.cityRoleNames(player),
      [],
    );
  }

  /**
   * LAN cities: every name must exist in the bundled Ukrainian catalog, and the
   * list only makes sense while the player wants LAN tournaments — dropping LAN
   * from `wantToPlay` clears it.
   */
  private async applyLanCities(
    player: Player,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const hasCities = 'lanCities' in payload;
    const hasFormats = 'wantToPlay' in payload;
    if (!hasCities && !hasFormats) return;

    const formats = (hasFormats ? payload['wantToPlay'] : player.wantToPlay) as
      | TournamentFormat[]
      | null
      | undefined;
    const wantsLan =
      Array.isArray(formats) && formats.includes(TournamentFormat.LAN);

    if (!wantsLan) {
      payload['lanCities'] = null;
      return;
    }
    if (!hasCities) return;

    const raw = payload['lanCities'];
    if (raw == null) {
      payload['lanCities'] = null;
      return;
    }
    const names = [
      ...new Set(
        (raw as unknown[])
          .map((n) => (typeof n === 'string' ? n.trim() : ''))
          .filter(Boolean),
      ),
    ];
    if (!names.length) {
      payload['lanCities'] = null;
      return;
    }

    const catalog = new Set(
      await this.locationsService.getCities(LAN_COUNTRY_CODE),
    );
    const unknown = names.filter((n) => !catalog.has(n));
    if (unknown.length) {
      throw new BadRequestException(
        `Невідомі міста для LAN-турнірів: ${unknown.join(', ')}`,
      );
    }
    payload['lanCities'] = names;
  }

  async remove(id: string): Promise<void> {
    const player = await this.playersRepo.findOneById(id);
    if (!player) {
      throw new NotFoundException('Гравця не знайдено');
    }
    // If this player captains any active team, hand off captaincy (promote the
    // next main player, or disband) and revoke their Dota2 league admin before
    // deleting — otherwise the team is left with a deleted captain.
    await this.teamsService.reassignCaptaincyBeforeDeletion(id);
    await this.playersRepo.remove(player);
  }
}
