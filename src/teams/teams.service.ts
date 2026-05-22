import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Team } from './team.entity';
import { TeamInviteRepository } from './team-invite.repository';
import { TeamsRepository } from './teams.repository';
import { CreateTeamDto } from './dto/create-team.dto';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { Role, getRoleColorByName } from '../user-roles/role.constants';
import { toPlayerRankDto } from '../players/dto/player-rank.dto';
import { TournamentDivision } from '../tournaments/tournaments.model';
import { DiscordBotService } from '../discord/discord-bot.service';
import { AuthService } from '../auth/auth.service';
import { Dota2Service } from '../dota2/dota2.service';
import {
  TeamResponseDto,
  TeamTournamentEmbeddedDto,
} from './dto/team-response.dto';
import { PlayerResponseDto } from '../players/dto/player-response.dto';
import { Tournament } from '../tournaments/tournaments.entity';

function computeTeamDivision(
  players: { rating: number }[],
): TournamentDivision | null {
  if (!players.length) return null;
  const ratings = players.map((p) => p.rating);
  const maxRating = Math.max(...ratings);
  const avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
  if (avgRating <= 2500 && maxRating <= 3500)
    return TournamentDivision.DIVISION_I;
  if (avgRating <= 4500 && maxRating <= 5500)
    return TournamentDivision.DIVISION_II;
  return TournamentDivision.DIVISION_III;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    private readonly teamsRepo: TeamsRepository,
    private readonly inviteRepo: TeamInviteRepository,
    private readonly discord: DiscordBotService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly authService: AuthService,
    private readonly dota2: Dota2Service,
  ) {}

  /** Для інших модулів (напр. турніри) — той самий DTO, що й у REST. */
  toTeamResponse(team: Team): TeamResponseDto {
    return this.mapTeamResponse(team);
  }

  async createTeam(
    dto: CreateTeamDto,
    captainId: string,
  ): Promise<TeamResponseDto> {
    const existingTeams = await this.teamsRepo.findByCaptainId(captainId);
    if (existingTeams.length > 0) {
      throw new ConflictException('Ви вже є капітаном іншої команди');
    }

    const { coachId, ...teamFields } = dto;
    const entity = this.teamsRepo.create({
      ...teamFields,
      captain: { id: captainId } as Player,
      mainPlayers: [{ id: captainId } as Player],
      ...(coachId ? { coach: { id: coachId } as Player } : {}),
    });
    const team = await this.teamsRepo.save(entity);
    await this.syncPlayerTeamLinks(team.id);

    const rolesRepo = this.dataSource.getRepository(UserRoles);
    const existing = await rolesRepo.findOne({
      where: { player: { id: captainId }, name: Role.CAPTAIN },
    });
    if (!existing) {
      await rolesRepo.save(
        rolesRepo.create({
          name: Role.CAPTAIN,
          isAdminRole: false,
          player: { id: captainId } as Player,
        }),
      );
    }

    await this.syncDiscordGuildRolesForPlayer(captainId);

    const full = await this.teamsRepo.findOneById(team.id);
    if (!full) {
      throw new InternalServerErrorException('Не вдалося завантажити команду');
    }
    return this.mapTeamResponse(full);
  }

  async findAll(): Promise<TeamResponseDto[]> {
    const teams = await this.teamsRepo.findAll();
    return teams.map((t) => this.mapTeamResponse(t));
  }

  async search() {
    const teams = await this.teamsRepo.findAll();
    const mapped = teams.map((t) => this.mapTeamResponse(t));
    return mapped;
  }

  async findOne(id: string): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOneById(id);
    if (!team) {
      throw new NotFoundException('Команду не знайдено');
    }
    return this.mapTeamResponse(team);
  }

  async update(id: string, payload: Partial<Team>): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOneById(id);
    if (!team) throw new NotFoundException('Команду не знайдено');

    const wasVerified = team.isVerified;
    Object.assign(team, payload);
    const saved = await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(id);

    if (!wasVerified && saved.isVerified) {
      void this.onTeamVerified(saved);
    }

    const reloaded = await this.teamsRepo.findOneById(id);
    if (!reloaded) throw new NotFoundException('Команду не знайдено');
    return this.mapTeamResponse(reloaded);
  }

  private async onTeamVerified(team: Team): Promise<void> {
    const division = computeTeamDivision(team.mainPlayers ?? []);
    if (!division) {
      this.logger.warn(
        `Team ${team.id} verified but division could not be determined — skipping Discord setup`,
      );
      return;
    }

    const roleId = await this.discord.createTeamRole(team.name);
    if (!roleId) return;

    const channelId = await this.discord.createDivisionVoiceChannel(
      team.name,
      division,
      roleId,
    );

    await this.teamsRepo.save(
      Object.assign(team, {
        discordRoleId: roleId,
        discordChannelId: channelId,
      }),
    );

    const allMembers = [
      team.captain,
      team.coach,
      ...(team.mainPlayers ?? []),
      ...(team.reservedPlayers ?? []),
    ].filter(Boolean) as { discordId: string | null }[];
    await this.discord.addPlayersToRole(allMembers, roleId);

    if (team.captain?.discordId) {
      await this.discord.addCaptainRole(team.captain.discordId);
    }

    if (team.captain?.steamId && team.captain?.verifiedAt) {
      void this.dota2.addLeagueAdmin(team.captain.steamId);
    }

    this.logger.log(
      `Discord setup complete for team ${team.id}: role=${roleId} channel=${channelId ?? 'null'} division=${division}`,
    );
  }

  async remove(id: string): Promise<void> {
    const team = await this.teamsRepo.findOneById(id);
    if (!team) throw new NotFoundException('Команду не знайдено');
    const captainId = team.captain?.id;
    const captainDiscordId = team.captain?.discordId ?? null;
    const { discordRoleId, discordChannelId } = team;

    await this.dataSource.transaction(async (manager) => {
      await this.resetPlayersTeamIdColumn(id, manager);
      await manager.remove(team);
    });

    if (captainId) {
      const rolesRepo = this.dataSource.getRepository(UserRoles);
      const captainRole = await rolesRepo.findOne({
        where: { player: { id: captainId }, name: Role.CAPTAIN },
      });
      if (captainRole) {
        await rolesRepo.remove(captainRole);
      }
      await this.syncDiscordGuildRolesForPlayer(captainId);
    }

    if (discordChannelId) {
      await this.discord.deleteChannel(discordChannelId);
    }
    if (discordRoleId) {
      await this.discord.deleteRole(discordRoleId);
    }
    if (captainDiscordId) {
      await this.discord.removeCaptainRole(captainDiscordId);
    }
  }

  async changeCaptain(
    teamId: string,
    newCaptainPlayerId: string,
    actorPlayerId: string,
  ): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOneWithRoster(teamId);
    if (!team) throw new NotFoundException('Команду не знайдено');

    const isAdmin = actorPlayerId === '__admin__';
    if (!isAdmin && team.captain?.id !== actorPlayerId) {
      throw new ForbiddenException(
        'Тільки капітан або адмін може передати капітанство',
      );
    }

    const newCaptain = (team.mainPlayers ?? []).find(
      (p) => p.id === newCaptainPlayerId,
    );
    if (!newCaptain) {
      throw new BadRequestException(
        'Новий капітан повинен бути основним гравцем команди',
      );
    }
    if (newCaptainPlayerId === team.captain?.id) {
      throw new BadRequestException('Цей гравець вже є капітаном');
    }

    const oldCaptain = team.captain;
    const oldCaptainDiscordId = team.captain?.discordId ?? null;
    team.captain = newCaptain;
    const saved = await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(teamId);

    if (oldCaptainDiscordId) {
      await this.discord.removeCaptainRole(oldCaptainDiscordId);
    }
    if (newCaptain.discordId) {
      await this.discord.addCaptainRole(newCaptain.discordId);
    }

    if (team.isVerified) {
      if (oldCaptain?.steamId) {
        void this.dota2.revokeLeagueAdmin(oldCaptain.steamId);
      }
      if (newCaptain.steamId && newCaptain.verifiedAt) {
        void this.dota2.addLeagueAdmin(newCaptain.steamId);
      }
    }

    const reloaded = await this.teamsRepo.findOneById(saved.id);
    if (!reloaded) throw new NotFoundException('Команду не знайдено');
    return this.mapTeamResponse(reloaded);
  }

  async addPlayerToTeam(
    teamId: string,
    playerId: string,
    slot: 'main' | 'reserved',
  ): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOneWithRoster(teamId);
    if (!team) throw new NotFoundException('Команду не знайдено');

    const player = await this.dataSource.getRepository(Player).findOne({
      where: { id: playerId },
    });
    if (!player) throw new NotFoundException('Гравця не знайдено');

    if (player.teamId !== null) {
      throw new ConflictException('Гравець вже є учасником іншої команди');
    }

    const main = team.mainPlayers ?? [];
    const reserved = team.reservedPlayers ?? [];
    const alreadyOnTeam = [...main, ...reserved].some((p) => p.id === playerId);
    if (alreadyOnTeam) {
      throw new ConflictException('Гравець вже є в складі цієї команди');
    }

    if (slot === 'main') {
      if (main.length >= 5) {
        throw new BadRequestException(
          'Основний склад вже заповнений (максимум 5 гравців)',
        );
      }
      team.mainPlayers = [...main, player];
    } else {
      if (reserved.length >= 3) {
        throw new BadRequestException(
          'Список запасних вже заповнений (максимум 3 гравців)',
        );
      }
      team.reservedPlayers = [...reserved, player];
    }

    await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(teamId);

    if (team.discordRoleId && player.discordId) {
      await this.discord.addMemberRole(player.discordId, team.discordRoleId);
    }

    const reloaded = await this.teamsRepo.findOneById(teamId);
    if (!reloaded) throw new NotFoundException('Команду не знайдено');
    return this.mapTeamResponse(reloaded);
  }

  async removePlayerFromTeam(
    teamId: string,
    playerId: string,
  ): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOneWithRoster(teamId);
    if (!team) {
      throw new NotFoundException('Team not found');
    }

    const pointsRepo = this.dataSource.getRepository(PlayerTournamentPoints);
    for (const t of team.tournaments ?? []) {
      const record = await pointsRepo.findOne({
        where: { playerId, tournamentId: t.id },
      });
      if (record && record.points > 0) {
        record.points = Math.floor(record.points * 0.3);
        await pointsRepo.save(record);
      }
    }

    const roster = [
      team.captain,
      team.coach,
      ...(team.mainPlayers ?? []),
      ...(team.reservedPlayers ?? []),
    ].filter(Boolean) as Player[];
    const removedDiscordId =
      roster.find((p) => p.id === playerId)?.discordId ?? null;

    const wasCaptain = team.captain?.id === playerId;
    const oldCaptainSteamId = wasCaptain
      ? (team.captain?.steamId ?? null)
      : null;
    team.mainPlayers = (team.mainPlayers || []).filter(
      (p) => p.id !== playerId,
    );
    team.reservedPlayers = (team.reservedPlayers || []).filter(
      (p) => p.id !== playerId,
    );
    if (team.coach?.id === playerId) {
      team.coach = null;
    }

    if (wasCaptain) {
      const nextCaptain = team.mainPlayers[0];
      if (!nextCaptain) {
        throw new BadRequestException(
          'Неможливо видалити капітана: у команди немає інших основних гравців для підвищення',
        );
      }
      team.captain = nextCaptain;
    }

    const saved = await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(teamId);

    if (team.discordRoleId && removedDiscordId) {
      await this.discord.removeMemberRole(removedDiscordId, team.discordRoleId);
    }
    if (wasCaptain) {
      if (removedDiscordId) {
        await this.discord.removeCaptainRole(removedDiscordId);
      }
      if (saved.captain?.discordId) {
        await this.discord.addCaptainRole(saved.captain.discordId);
      }
      if (team.isVerified) {
        if (oldCaptainSteamId) {
          void this.dota2.revokeLeagueAdmin(oldCaptainSteamId);
        }
        if (saved.captain?.steamId && saved.captain?.verifiedAt) {
          void this.dota2.addLeagueAdmin(saved.captain.steamId);
        }
      }
    }

    const reloaded = await this.teamsRepo.findOneById(teamId);
    if (!reloaded) throw new NotFoundException('Team not found');
    return this.mapTeamResponse(reloaded);
  }

  private async resetPlayersTeamIdColumn(
    teamId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Player)
      .set({ teamId: null })
      .where('"teamId" = :tid', { tid: teamId })
      .execute();
  }

  private async syncDiscordGuildRolesForPlayer(
    playerId: string,
  ): Promise<void> {
    const player = await this.dataSource.getRepository(Player).findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    if (player) {
      await this.authService.syncPlayerGuildRoles(player);
    }
  }

  private async syncPlayerTeamLinks(teamId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.resetPlayersTeamIdColumn(teamId, manager);

      const team = await manager.findOne(Team, {
        where: { id: teamId },
        relations: ['captain', 'coach', 'mainPlayers', 'reservedPlayers'],
      });
      if (!team) return;

      const ids = new Set<string>();
      if (team.captain?.id) ids.add(team.captain.id);
      if (team.coach?.id) ids.add(team.coach.id);
      for (const p of team.mainPlayers ?? []) ids.add(p.id);
      for (const p of team.reservedPlayers ?? []) ids.add(p.id);

      if (ids.size === 0) return;

      await manager
        .createQueryBuilder()
        .update(Player)
        .set({ teamId })
        .where('id IN (:...ids)', { ids: [...ids] })
        .execute();
    });
  }

  async reassignCaptainIfPlayerIsCaptain(playerId: string): Promise<void> {
    const teams = await this.teamsRepo.findByCaptainId(playerId);

    for (const team of teams) {
      team.mainPlayers = team.mainPlayers || [];
      const nextCaptain = team.mainPlayers.find((p) => p.id !== playerId);
      if (!nextCaptain) {
        throw new BadRequestException(
          `Неможливо видалити гравця ${playerId}: у команди ${team.id} немає інших основних гравців для підвищення`,
        );
      }
      const oldCaptainSteamId = team.captain?.steamId ?? null;
      team.captain = nextCaptain;
      await this.teamsRepo.save(team);
      await this.syncPlayerTeamLinks(team.id);
      if (team.isVerified) {
        if (oldCaptainSteamId) {
          void this.dota2.revokeLeagueAdmin(oldCaptainSteamId);
        }
        if (nextCaptain.steamId && nextCaptain.verifiedAt) {
          void this.dota2.addLeagueAdmin(nextCaptain.steamId);
        }
      }
    }
  }

  async createInvite(
    teamId: string,
    captainPlayerId: string,
    slot: 'main' | 'reserved' | 'coach',
  ): Promise<{ token: string; expiresAt: Date }> {
    const team = await this.teamsRepo.findOneWithRoster(teamId);
    if (!team) throw new NotFoundException('Команду не знайдено');
    if (team.captain?.id !== captainPlayerId) {
      throw new ForbiddenException('Тільки капітан може створювати запрошення');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = this.inviteRepo.create({
      token,
      teamId,
      createdById: captainPlayerId,
      slot,
      expiresAt,
    });
    await this.inviteRepo.save(invite);
    return { token, expiresAt };
  }

  async getInviteInfo(token: string): Promise<{
    teamId: string;
    teamName: string;
    logoUrl: string | null;
    slot: 'main' | 'reserved' | 'coach';
    expiresAt: Date;
  }> {
    const invite = await this.inviteRepo.findByToken(token);
    if (!invite) throw new NotFoundException('Запрошення не знайдено');
    if (invite.expiresAt < new Date()) {
      throw new GoneException('Запрошення вже недійсне');
    }
    return {
      teamId: invite.teamId,
      teamName: invite.team.name,
      logoUrl: invite.team.logoUrl,
      slot: invite.slot,
      expiresAt: invite.expiresAt,
    };
  }

  async acceptInvite(token: string, playerId: string): Promise<void> {
    const invite = await this.inviteRepo.findByToken(token);
    if (!invite) throw new NotFoundException('Запрошення не знайдено');
    if (invite.expiresAt < new Date()) {
      throw new GoneException('Запрошення вже недійсне');
    }

    if (invite.slot === 'coach') {
      const team = await this.teamsRepo.findOneWithRoster(invite.teamId);
      if (!team) throw new NotFoundException('Команду не знайдено');

      const player = await this.dataSource.getRepository(Player).findOne({
        where: { id: playerId },
      });
      if (!player) throw new NotFoundException('Гравця не знайдено');

      if (team.coach !== null) {
        throw new ConflictException('У команді вже є тренер');
      }
      if (player.teamId !== null) {
        throw new ConflictException('Гравець вже є учасником іншої команди');
      }

      team.coach = player;
      await this.teamsRepo.save(team);
      await this.syncPlayerTeamLinks(invite.teamId);

      const teamRoleId: string | null = team.discordRoleId;
      if (teamRoleId && player.discordId) {
        await this.discord.addMemberRole(player.discordId, teamRoleId);
      }
    } else {
      await this.addPlayerToTeam(invite.teamId, playerId, invite.slot);
    }

    await this.inviteRepo.remove(invite);
  }

  private mapPlayerForTeamResponse(player: Player): PlayerResponseDto {
    const rating = player.rating ?? 0;
    return {
      id: player.id,
      steamId: player.steamId ?? null,
      discordId: player.discordId ?? null,
      telegramId: player.telegramId ?? null,
      avatarUrl: player.avatarUrl ?? null,
      discordName: player.discordName ?? null,
      discordUsername: player.discordUsername ?? null,
      rating,
      rank: toPlayerRankDto(rating),
      positions: player.positions ?? null,
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

  private mapTournamentEmbedded(t: Tournament): TeamTournamentEmbeddedDto {
    return {
      id: t.id,
      name: t.name,
      prizePool: t.prizePool ?? 0,
      headerBannerUrl: t.headerBannerUrl ?? null,
      listBannerUrl: t.listBannerUrl ?? null,
      tournamentSlots: t.tournamentSlots ?? null,
      registrationStartsAt: t.registrationStartsAt,
      registrationEndsAt: t.registrationEndsAt,
      tournamentStartsAt: t.tournamentStartsAt,
      tournamentEndsAt: t.tournamentEndsAt,
      tournamentStatus: t.tournamentStatus,
      tournamentGridUrl: t.tournamentGridUrl ?? null,
    };
  }

  private mapTeamResponse(team: Team): TeamResponseDto {
    if (!team.captain) {
      throw new InternalServerErrorException('Команда без капітана');
    }
    return {
      id: team.id,
      name: team.name,
      logoUrl: team.logoUrl ?? null,
      dotaTeamId: team.dotaTeamId ?? null,
      isVerified: team.isVerified,
      isPlayingTournament: team.isPlayingTournament,
      verifiedAt: team.verifiedAt ?? null,
      captain: this.mapPlayerForTeamResponse(team.captain),
      coach: team.coach ? this.mapPlayerForTeamResponse(team.coach) : null,
      mainPlayers: (team.mainPlayers ?? []).map((p) =>
        this.mapPlayerForTeamResponse(p),
      ),
      reservedPlayers: (team.reservedPlayers ?? []).map((p) =>
        this.mapPlayerForTeamResponse(p),
      ),
      tournaments: (team.tournaments ?? []).map((t) =>
        this.mapTournamentEmbedded(t),
      ),
      division: computeTeamDivision(team.mainPlayers ?? []),
    };
  }
}
