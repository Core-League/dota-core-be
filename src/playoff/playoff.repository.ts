import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Playoff } from './playoff.entity';

@Injectable()
export class PlayoffRepository {
  private readonly repo: Repository<Playoff>;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.repo = dataSource.getRepository(Playoff);
  }

  findByTournamentId(tournamentId: string): Promise<Playoff | null> {
    return this.repo.findOne({ where: { tournamentId } });
  }

  save(playoff: Playoff): Promise<Playoff> {
    return this.repo.save(playoff);
  }

  create(payload: Partial<Playoff>): Playoff {
    return this.repo.create(payload);
  }
}
