import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tournament } from './tournaments.entity';

@Injectable()
export class TournamentsRepository {
  constructor(
    @InjectRepository(Tournament)
    private readonly repo: Repository<Tournament>,
  ) {}

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
