import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { QualificationMatch } from './qualification-match.entity';

@Injectable()
export class QualificationMatchRepository {
  private readonly repo: Repository<QualificationMatch>;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.repo = dataSource.getRepository(QualificationMatch);
  }

  create(payload: Partial<QualificationMatch>): QualificationMatch {
    return this.repo.create(payload);
  }

  save(m: QualificationMatch): Promise<QualificationMatch> {
    return this.repo.save(m);
  }

  saveMany(matches: QualificationMatch[]): Promise<QualificationMatch[]> {
    return this.repo.save(matches);
  }

  findOneById(id: string): Promise<QualificationMatch | null> {
    return this.repo.findOne({
      where: { id },
      relations: [
        'qualification',
        'qualification.tournament',
        'teamA',
        'teamA.mainPlayers',
        'teamA.reservedPlayers',
        'teamA.tournament',
        'teamB',
        'teamB.mainPlayers',
        'teamB.reservedPlayers',
        'teamB.tournament',
        'winner',
      ],
    });
  }
}
