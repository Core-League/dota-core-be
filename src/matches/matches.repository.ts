import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Match } from './matches.entity';

@Injectable()
export class MatchesRepository {
  constructor(
    @InjectRepository(Match)
    private readonly repo: Repository<Match>,
  ) {}

  create(payload: Partial<Match>): Match {
    return this.repo.create(payload);
  }

  save(match: Match): Promise<Match> {
    return this.repo.save(match);
  }

  findAll(): Promise<Match[]> {
    return this.repo.find({ relations: ['teamA', 'teamB', 'winner'] });
  }

  findOneById(id: string): Promise<Match | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['teamA', 'teamB', 'winner'],
    });
  }

  remove(match: Match): Promise<Match> {
    return this.repo.remove(match);
  }
}
