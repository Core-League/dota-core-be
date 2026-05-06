import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Team } from './team.entity';
import { TeamsRepository } from './teams.repository';
import { CreateTeamDto } from './dto/create-team.dto';
import { SearchTeamsDto } from './dto/search-teams.dto';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { Role } from '../user-roles/role.constants';
import { toPlayerRankDto } from '../players/dto/player-rank.dto';

@Injectable()
export class TeamsService {
  constructor(
    private readonly teamsRepo: TeamsRepository,
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
    Object.assign(team, payload);
    const saved = await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(id);
    return this.mapTeam(saved);
  }

  async remove(id: string): Promise<void> {
    const team = await this.teamsRepo.findOneById(id);
    if (!team) throw new NotFoundException('Команду не знайдено');
    const captainId = team.captain?.id;

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
}
