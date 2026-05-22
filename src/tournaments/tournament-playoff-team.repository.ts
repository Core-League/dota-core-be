import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { findEligibleQualificationTeamIds } from './tournament-playoff-team.eligibility';
import { TournamentPlayoffTeam } from './tournament-playoff-team.entity';
import { Team } from '../teams/team.entity';

const TEAM_RELATIONS = [
  'captain',
  'captain.roles',
  'coach',
  'coach.roles',
  'mainPlayers',
  'mainPlayers.roles',
  'reservedPlayers',
  'reservedPlayers.roles',
  'tournament',
];

@Injectable()
export class TournamentPlayoffTeamRepository {
  private readonly repo: Repository<TournamentPlayoffTeam>;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository(TournamentPlayoffTeam);
  }

  findByTournamentId(tournamentId: string): Promise<TournamentPlayoffTeam[]> {
    return this.repo.find({
      where: { tournamentId },
      relations: TEAM_RELATIONS.map((r) => `team.${r}`).concat(['team']),
    });
  }

  /**
   * IDs of teams drawn into qualification and/or registered on this tournament
   * (`findEligibleQualificationTeamIds`).
   */
  async findEligibleQualificationTeamIds(
    tournamentId: string,
  ): Promise<string[]> {
    return findEligibleQualificationTeamIds(this.dataSource, tournamentId);
  }

  /** @deprecated Use findEligibleQualificationTeamIds */
  async findVerifiedQualificationTeamIds(
    tournamentId: string,
  ): Promise<string[]> {
    return this.findEligibleQualificationTeamIds(tournamentId);
  }

  /** Returns full Team entities for eligible qualification teams. */
  async findQualificationTeams(tournamentId: string): Promise<Team[]> {
    const ids = await this.findEligibleQualificationTeamIds(tournamentId);
    if (!ids.length) return [];
    return this.dataSource.getRepository(Team).find({
      where: { id: In(ids) },
      relations: TEAM_RELATIONS,
    });
  }

  /** Inserts rows; silently ignores teams already in the playoff list. */
  async addTeams(tournamentId: string, teamIds: string[]): Promise<void> {
    if (!teamIds.length) return;
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(TournamentPlayoffTeam)
      .values(teamIds.map((teamId) => ({ tournamentId, teamId })))
      .orIgnore()
      .execute();
  }

  /** Removes matching rows; silently ignores IDs not present. */
  async removeTeams(tournamentId: string, teamIds: string[]): Promise<void> {
    if (!teamIds.length) return;
    await this.repo.delete({ tournamentId, teamId: In(teamIds) });
  }
}
