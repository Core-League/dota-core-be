import { Injectable, NotFoundException } from '@nestjs/common';
import { Tournament } from './tournaments.entity';
import { TournamentsRepository } from './tournaments.repository';

@Injectable()
export class TournamentsService {
  constructor(private readonly tournamentsRepo: TournamentsRepository) {}

  create(payload: Partial<Tournament>): Promise<Tournament> {
    const entity = this.tournamentsRepo.create(payload);
    return this.tournamentsRepo.save(entity);
  }

  findAll(): Promise<Tournament[]> {
    return this.tournamentsRepo.findAll();
  }

  async findOne(id: string): Promise<Tournament> {
    const tournament = await this.tournamentsRepo.findOneById(id);
    if (!tournament) {
      throw new NotFoundException('Турнір не знайдено');
    }
    return tournament;
  }

  async update(id: string, payload: Partial<Tournament>): Promise<Tournament> {
    const tournament = await this.findOne(id);
    Object.assign(tournament, payload);
    return this.tournamentsRepo.save(tournament);
  }

  async remove(id: string): Promise<void> {
    const tournament = await this.findOne(id);
    await this.tournamentsRepo.remove(tournament);
  }
}
