import { Injectable, NotFoundException } from '@nestjs/common';
import { Match } from './matches.entity';
import { MatchesRepository } from './matches.repository';

@Injectable()
export class MatchesService {
  constructor(private readonly matchesRepo: MatchesRepository) {}

  create(payload: Partial<Match>): Promise<Match> {
    const entity = this.matchesRepo.create(payload);
    return this.matchesRepo.save(entity);
  }

  findAll(): Promise<Match[]> {
    return this.matchesRepo.findAll();
  }

  async findOne(id: string): Promise<Match> {
    const match = await this.matchesRepo.findOneById(id);
    if (!match) {
      throw new NotFoundException('Матч не знайдено');
    }
    return match;
  }

  async update(id: string, payload: Partial<Match>): Promise<Match> {
    const match = await this.findOne(id);
    Object.assign(match, payload);
    return this.matchesRepo.save(match);
  }

  async remove(id: string): Promise<void> {
    const match = await this.findOne(id);
    await this.matchesRepo.remove(match);
  }
}
