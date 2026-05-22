import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
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
        'teamA.tournaments',
        'teamB',
        'teamB.mainPlayers',
        'teamB.reservedPlayers',
        'teamB.tournaments',
        'winner',
      ],
    });
  }

  findByTournamentAndDotaTeams(
    tournamentId: string,
    dotaTeamIdA: string,
    dotaTeamIdB: string,
  ): Promise<QualificationMatch | null> {
    const common = {
      dotaMatchId: IsNull(),
      qualification: { tournament: { id: tournamentId } },
    };
    return this.repo.findOne({
      where: [
        {
          ...common,
          teamA: { dotaTeamId: dotaTeamIdA },
          teamB: { dotaTeamId: dotaTeamIdB },
        },
        {
          ...common,
          teamA: { dotaTeamId: dotaTeamIdB },
          teamB: { dotaTeamId: dotaTeamIdA },
        },
      ],
      relations: [
        'qualification',
        'qualification.tournament',
        'teamA',
        'teamA.mainPlayers',
        'teamA.reservedPlayers',
        'teamA.tournaments',
        'teamB',
        'teamB.mainPlayers',
        'teamB.reservedPlayers',
        'teamB.tournaments',
        'winner',
      ],
    });
  }
}
