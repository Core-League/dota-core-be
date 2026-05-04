import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Team } from './team.entity';
import { TeamsRepository } from './teams.repository';
import { CreateTeamDto } from './dto/create-team.dto';
import { SearchTeamsDto } from './dto/search-teams.dto';
import { Tournament } from '../tournaments/tournaments.entity';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { Role } from '../user-roles/role.constants';

@Injectable()
export class TeamsService {
  constructor(
    private readonly teamsRepo: TeamsRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async createTeam(dto: CreateTeamDto, captainId: string): Promise<Team> {
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

    return team;
  }

  findAll(): Promise<Team[]> {
    return this.teamsRepo.findAll();
  }

  /**
   * Lists teams with optional `tournaments` array (from `team.tournament`, ManyToOne).
   */
  async search(
    dto: SearchTeamsDto = {},
  ): Promise<Array<Team & { tournaments?: Tournament[] }>> {
    const teams = await this.teamsRepo.findAll();
    if (!dto.withTournaments) {
      return teams;
    }
    return teams.map((t) => ({
      ...t,
      tournaments: t.tournament ? [t.tournament] : [],
    }));
  }

  async findOne(id: string): Promise<Team> {
    const team = await this.teamsRepo.findOneById(id);
    if (!team) {
      throw new NotFoundException('Команду не знайдено');
    }
    return team;
  }

  async update(id: string, payload: Partial<Team>): Promise<Team> {
    const team = await this.findOne(id);
    Object.assign(team, payload);
    const saved = await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(id);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const team = await this.findOne(id);
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
    }
  }

  async removePlayerFromTeam(teamId: string, playerId: string): Promise<Team> {
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

    const saved = await this.teamsRepo.save(team);
    await this.syncPlayerTeamLinks(teamId);
    return saved;
  }

  /**
   * Вирівнює player.teamId з поточним ростером (капітан, тренер, основа, запасні).
   * У кого був цей teamId, але гравця вже немає в команді — ставить null.
   */
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
}
