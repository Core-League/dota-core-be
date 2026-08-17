import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Tournament } from './tournaments.entity';

@Injectable()
export class TournamentsRepository {
  private readonly repo: Repository<Tournament>;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.repo = dataSource.getRepository(Tournament);
  }

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
      relations: [
        'teams',
        'teams.captain',
        'teams.coach',
        'teams.mainPlayers',
        'teams.reservedPlayers',
        'eligibleRoles',
      ],
    });
  }

  /**
   * Targeted column write. Preferred over load-modify-`save` for single-field
   * toggles: it never re-saves the loaded relation graph, so it cannot touch the
   * `tournament_team` join table.
   */
  async updateRegistrationClosedAt(
    id: string,
    registrationClosedAt: Date | null,
  ): Promise<void> {
    await this.repo.update({ id }, { registrationClosedAt });
  }

  remove(tournament: Tournament): Promise<Tournament> {
    return this.repo.remove(tournament);
  }
}
