import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TeamInvite } from './team-invite.entity';

@Injectable()
export class TeamInviteRepository {
  private readonly repo: Repository<TeamInvite>;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.repo = dataSource.getRepository(TeamInvite);
  }

  create(payload: Partial<TeamInvite>): TeamInvite {
    return this.repo.create(payload);
  }

  save(invite: TeamInvite): Promise<TeamInvite> {
    return this.repo.save(invite);
  }

  findByToken(token: string): Promise<TeamInvite | null> {
    return this.repo.findOne({
      where: { token },
      relations: [
        'team',
        'team.captain',
        'team.mainPlayers',
        'team.reservedPlayers',
      ],
    });
  }

  remove(invite: TeamInvite): Promise<TeamInvite> {
    return this.repo.remove(invite);
  }
}
