import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Team } from './team.entity';
import { TeamInviteRepository } from './team-invite.repository';
import { TeamsRepository } from './teams.repository';
import { CreateTeamDto } from './dto/create-team.dto';
import { SearchTeamsDto } from './dto/search-teams.dto';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { Role } from '../user-roles/role.constants';
import { toPlayerRankDto } from '../players/dto/player-rank.dto';
import { TournamentDivision } from '../tournaments/tournaments.model';
import { DiscordBotService } from '../discord/discord-bot.service';

function computeTeamDivision(
  players: { rating: number }[],
): TournamentDivision | null {
  if (!players.length) return null;
  const ratings = players.map((p) => p.rating);
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  const max = Math.max(...ratings);
  if (avg <= 2500 && max <= 3500) return TournamentDivision.DIVISION_I;
  if (avg <= 4500 && max <= 5500) return TournamentDivision.DIVISION_II;
  if (avg <= 7000) return TournamentDivision.DIVISION_III;
  return null;
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
  ) {}

  private withRank(player: Player | null | undefined) {
    if (!player) return player ?? null;
    return { ...player, rank: toPlayerRankDto(player.rating) };
  }

  private mapTeam(team: Team) {
    return {
      ...team,
      captain: this.withRank(team.captain),
      coach: this.withRank(team.coach),
      mainPlayers: (team.mainPlayers ?? []).map((p) => this.withRank(p)!),
      reservedPlayers: (team.reservedPlayers ?? []).map(
        (p) => this.withRank(p)!,
      ),
    };
  }

  async createTeam(dto: CreateTeamDto, captainId: string) {
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

    return this.mapTeam(team);
  }

  async findAll() {
    const teams = await this.teamsRepo.findAll();
    return teams.map((t) => this.mapTeam(t));
  }

  /**
   * Lists teams with optional `tournaments` array (from `team.tournament`, ManyToOne).
   */
  async search(dto: SearchTeamsDto = {}) {
    const teams = await this.teamsRepo.findAll();
    const mapped = teams.map((t) => this.mapTeam(t));
    if (!dto.withTournaments) {
      return mapped;
    }
    return mapped.map((t) => ({
      ...t,
      tournaments: t.tournament ? [t.tournament] : [],
    }));
  }

  async findOne(id: string) {
    const team = await this.teamsRepo.findOneById(id);
    if (!team) {
      throw new NotFoundException('Команду не знайдено');
    }
    return this.mapTeam(team);
  }

  async update(id: string, payload: Partial<Team>) {
    const team = await this.teamsRepo.findOneById(id);
    if (!team) throw new NotFoundException('Команду не знайдено');

    const wasVerified = team.isVerified;
    Object.assign(team, payload);
    const saved = await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(id);

    if (!wasVerified && saved.isVerified) {
      void this.onTeamVerified(saved);
    }

    return this.mapTeam(saved);
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
  ): Promise<ReturnType<TeamsService['mapTeam']>> {
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

    return this.mapTeam(saved);
  }

  async addPlayerToTeam(
    teamId: string,
    playerId: string,
    slot: 'main' | 'reserved',
  ) {
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
          'Список запасних вже заповнений (максимум 3 гравці)',
        );
      }
      team.reservedPlayers = [...reserved, player];
    }

    const saved = await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(teamId);

    if (team.discordRoleId && player.discordId) {
      await this.discord.addMemberRole(player.discordId, team.discordRoleId);
    }

    return this.mapTeam(saved);
  }

  async removePlayerFromTeam(teamId: string, playerId: string) {
    const team = await this.teamsRepo.findOneWithRoster(teamId);
    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // Deduct 70% of tournament points if team is in an active tournament
    if (team.tournament?.id) {
      const tournamentId = team.tournament.id;
      const pointsRepo = this.dataSource.getRepository(PlayerTournamentPoints);
      const record = await pointsRepo.findOne({
        where: { playerId, tournamentId },
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
    }

    return this.mapTeam(saved);
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

  /**
   * Вирівнює player.teamId з поточним ростером (капітан, тренер, основа, запасні).
   * У кого був цей teamId, але гравця вже немає в команді — ставить null.
   */
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
      team.captain = nextCaptain;
      await this.teamsRepo.save(team);
      await this.syncPlayerTeamLinks(team.id);
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const teamRoleId: string | null = team.discordRoleId;
      if (teamRoleId && player.discordId) {
        await this.discord.addMemberRole(player.discordId, teamRoleId);
      }
    } else {
      await this.addPlayerToTeam(invite.teamId, playerId, invite.slot);
    }

    await this.inviteRepo.remove(invite);
  }
}
