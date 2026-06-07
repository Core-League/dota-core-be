import type { Team } from '../../entities/finance/team';

export interface ITeamRepository {
  findByName(name: string): Promise<Team | null>;
  findAll(): Promise<Team[]>;
}
