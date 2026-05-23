import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Team } from './team.entity';

@Injectable()
export class TeamsRepository {
  private readonly repo: Repository<Team>;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.repo = dataSource.getRepository(Team);
  }

  create(payload: Partial<Team>): Team {
    return this.repo.create(payload);
  }

  save(team: Team): Promise<Team> {
    return this.repo.save(team);
  }

  findAll(): Promise<Team[]> {
    return this.repo.find({
      where: { disbandedAt: IsNull() },
      relations: [
        'captain',
        'captain.roles',
        'coach',
        'coach.roles',
        'mainPlayers',
        'mainPlayers.roles',
        'reservedPlayers',
        'reservedPlayers.roles',
        'tournaments',
      ],
    });
  }

  findOneById(id: string): Promise<Team | null> {
    return this.repo.findOne({
      where: { id },
      relations: [
        'captain',
        'captain.roles',
        'coach',
        'coach.roles',
        'mainPlayers',
        'mainPlayers.roles',
        'reservedPlayers',
        'reservedPlayers.roles',
        'tournaments',
      ],
    });
  }

  findOneWithRoster(id: string): Promise<Team | null> {
    return this.repo.findOne({
      where: { id },
      relations: [
        'captain',
        'captain.roles',
        'coach',
        'coach.roles',
        'mainPlayers',
        'mainPlayers.roles',
        'reservedPlayers',
        'reservedPlayers.roles',
        'tournaments',
      ],
    });
  }

  findByCaptainId(playerId: string): Promise<Team[]> {
    return this.repo.find({
      where: { captain: { id: playerId }, disbandedAt: IsNull() },
      relations: ['captain', 'mainPlayers'],
    });
  }

  remove(team: Team): Promise<Team> {
    return this.repo.remove(team);
  }
}
