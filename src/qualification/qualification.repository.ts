import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Qualification } from './qualification.entity';

@Injectable()
export class QualificationRepository {
  private readonly repo: Repository<Qualification>;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.repo = dataSource.getRepository(Qualification);
  }

  create(payload: Partial<Qualification>): Qualification {
    return this.repo.create(payload);
  }

  save(q: Qualification): Promise<Qualification> {
    return this.repo.save(q);
  }

  findByTournamentId(tournamentId: string): Promise<Qualification | null> {
    return this.repo.findOne({
      where: { tournament: { id: tournamentId } },
      relations: ['tournament', 'matches', 'matches.teamA', 'matches.teamB', 'matches.winner'],
    });
  }
}
