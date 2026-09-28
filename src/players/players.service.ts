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
import { TeamsService } from '../teams/teams.service';
import { LocationsService } from '../locations/locations.service';
import {
  DiscordBotService,
  LanRoleSyncReport,
} from '../discord/discord-bot.service';

@Injectable()
export class PlayersService {
  private readonly logger = new Logger(PlayersService.name);

  constructor(
    private readonly playersRepo: PlayersRepository,
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
    const prevLanCities = player.lanCities ?? [];
    Object.assign(player, safePayload);
    await this.playersRepo.save(player);
    if ('lanCities' in safePayload) {
      this.syncLanCityRoles(player, prevLanCities);
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
   * Discord mirror of `lanCities` (one yellow role per city). Fire-and-forget:
   * the save must not wait on Discord rate limits, and the bot service already
   * logs and swallows its own failures.
   */
  private syncLanCityRoles(player: Player, prevLanCities: string[]): void {
    if (!player.discordId) return;
    void this.discord
      .syncLanCityRoles(player.discordId, player.lanCities ?? [], prevLanCities)
      .catch((err: unknown) =>
        this.logger.warn(
          `LAN city role sync failed for player ${player.id}`,
          err instanceof Error ? err.message : err,
        ),
      );
  }

  /**
   * Re-applies every saved LAN city as a Discord role and reports what happened.
   * Idempotent (assigning a role the member already has is a no-op for Discord);
   * meant for the player to self-heal and for diagnosing bot permissions.
   */
  async resyncLanCityRoles(playerId: string): Promise<LanRoleSyncReport> {
    const player = await this.playersRepo.findOneById(playerId);
    if (!player) {
      throw new NotFoundException('Гравця не знайдено');
    }
    return this.discord.syncLanCityRoles(
      player.discordId ?? '',
      player.lanCities ?? [],
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

    const catalog = new Set(await this.locationsService.getCities('UA'));
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
