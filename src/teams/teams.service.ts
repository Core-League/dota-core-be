import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Team } from './team.entity';
import { TeamsRepository } from './teams.repository';
import { CreateTeamDto } from './dto/create-team.dto';
import {
  TeamResponseDto,
  TeamTournamentEmbeddedDto,
} from './dto/team-response.dto';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { Role, getRoleColorByName } from '../user-roles/role.constants';
import { toPlayerRankDto } from '../players/dto/player-rank.dto';
import { PlayerResponseDto } from '../players/dto/player-response.dto';
import { Tournament } from '../tournaments/tournaments.entity';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class TeamsService {
  constructor(
    private readonly teamsRepo: TeamsRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly authService: AuthService,
  ) {}

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
    const rows = await this.teamsRepo.findAll();
    return rows.map((t) => this.mapTeamResponse(t));
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
    if (!team) {
      throw new NotFoundException('Команду не знайдено');
    }
    Object.assign(team, payload);
    await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(id);
    const reloaded = await this.teamsRepo.findOneById(id);
    if (!reloaded) {
      throw new NotFoundException('Команду не знайдено');
    }
    return this.mapTeamResponse(reloaded);
  }

  async remove(id: string): Promise<void> {
    const team = await this.teamsRepo.findOneById(id);
    if (!team) {
      throw new NotFoundException('Команду не знайдено');
    }
    const captainId = team.captain?.id;
    await this.teamsRepo.remove(team);

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
  }

  async removePlayerFromTeam(
    teamId: string,
    playerId: string,
  ): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOneWithRoster(teamId);
    if (!team) {
      throw new NotFoundException('Team not found');
    }

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

    await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(teamId);
    const reloaded = await this.teamsRepo.findOneById(teamId);
    if (!reloaded) {
      throw new NotFoundException('Team not found');
    }
    return this.mapTeamResponse(reloaded);
  }

  /**
   * Вирівнює player.teamId з поточним ростером (капітан, тренер, основа, запасні).
   * У кого був цей teamId, але гравця вже немає в команді — ставить null.
   */
  private async syncDiscordGuildRolesForPlayer(playerId: string): Promise<void> {
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
      await manager
        .createQueryBuilder()
        .update(Player)
        .set({ teamId: null })
        .where('"teamId" = :tid', { tid: teamId })
        .execute();

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

  private mapTournamentEmbedded(
    t: Tournament | null | undefined,
  ): TeamTournamentEmbeddedDto | null {
    if (!t) return null;
    return {
      id: t.id,
      name: t.name,
      prizePool: t.prizePool,
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
      tournament: this.mapTournamentEmbedded(team.tournament),
    };
  }
}
