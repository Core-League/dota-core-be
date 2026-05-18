import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PlayoffMatch } from './playoff-match.entity';

@Injectable()
export class PlayoffMatchRepository {
  private readonly repo: Repository<PlayoffMatch>;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.repo = dataSource.getRepository(PlayoffMatch);
  }

  save(match: PlayoffMatch): Promise<PlayoffMatch> {
    return this.repo.save(match);
  }

  create(payload: Partial<PlayoffMatch>): PlayoffMatch {
    return this.repo.create(payload);
  }

  findByPlayoffId(playoffId: string): Promise<PlayoffMatch[]> {
    return this.repo.find({
      where: { playoffId },
      order: { createdAt: 'ASC' },
    });
  }

  async deleteByTeamId(teamId: string): Promise<void> {
    await this.repo.delete([{ teamAId: teamId }, { teamBId: teamId }]);
  }
}
