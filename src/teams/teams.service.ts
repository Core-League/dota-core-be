import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';
import { Player } from '../players/player.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { TeamsRepository } from './teams.repository';

@Injectable()
export class TeamsService {
  constructor(
    private readonly teamsRepo: TeamsRepository,
    @InjectRepository(Player) private readonly playersRepo: Repository<Player>,
    @InjectRepository(Tournament)
    private readonly tournamentsRepo: Repository<Tournament>,
  ) {}

  create(payload: Partial<Team>): Promise<Team> {
    const entity = this.teamsRepo.create(payload);
    return this.teamsRepo.save(entity);
  }

  findAll(): Promise<Team[]> {
    return this.teamsRepo.findAll();
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
    return this.teamsRepo.save(team);
  }

  async remove(id: string): Promise<void> {
    const team = await this.findOne(id);
    await this.teamsRepo.remove(team);
  }

  /**
   * Removes a player from a team (main/reserved/captain) and reassigns captain if needed.
   * If the departing player was captain, the next available main player becomes captain.
   */
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

    if (wasCaptain) {
      const nextCaptain = team.mainPlayers[0];
      if (!nextCaptain) {
        throw new BadRequestException(
          'Неможливо видалити капітана: у команди немає інших основних гравців для підвищення',
        );
      }
      team.captain = nextCaptain;
    }

    return this.teamsRepo.save(team);
  }

  /**
   * Helper to reassign captain when a Player entity is being deleted.
   * Call this before deleting the Player to keep FK constraints satisfied.
   */
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
    }
  }
}
