import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Tournament } from './tournaments.entity';

@Injectable()
export class TournamentsRepository {
  private readonly repo: Repository<Tournament>;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.repo = dataSource.getRepository(Tournament);
  }

  create(payload: Partial<Tournament>): Tournament {
    return this.repo.create(payload);
  }

  save(tournament: Tournament): Promise<Tournament> {
    return this.repo.save(tournament);
  }

  findAll(): Promise<Tournament[]> {
    return this.repo.find({ relations: ['teams', 'eligibleRoles'] });
  }

  findOneById(id: string): Promise<Tournament | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['teams', 'eligibleRoles'],
    });
  }

  remove(tournament: Tournament): Promise<Tournament> {
    return this.repo.remove(tournament);
  }
}
