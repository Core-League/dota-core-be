import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
      relations: [
        'captain',
        'coach',
        'mainPlayers',
        'reservedPlayers',
        'tournament',
      ],
    });
  }

  findOneById(id: string): Promise<Team | null> {
    return this.repo.findOne({
      where: { id },
      relations: [
        'captain',
        'coach',
        'mainPlayers',
        'reservedPlayers',
        'tournament',
      ],
    });
  }

  findOneWithRoster(id: string): Promise<Team | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['captain', 'coach', 'mainPlayers', 'reservedPlayers'],
    });
  }

  findByCaptainId(playerId: string): Promise<Team[]> {
    return this.repo.find({
      where: { captain: { id: playerId } },
      relations: ['captain', 'mainPlayers'],
    });
  }

  remove(team: Team): Promise<Team> {
    return this.repo.remove(team);
  }
}
