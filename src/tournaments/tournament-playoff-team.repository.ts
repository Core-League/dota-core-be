import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
  'tournaments',
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

  /** Returns team IDs that appear in at least one verified match (winner IS NOT NULL). */
  async findVerifiedQualificationTeamIds(
    tournamentId: string,
  ): Promise<string[]> {
    const rows: Array<{ team_id: string }> = await this.dataSource.query(
      `SELECT DISTINCT team_id FROM (
         SELECT qm."teamAId" AS team_id
         FROM qualification_match qm
         INNER JOIN qualification q ON q.id = qm."qualificationId"
         WHERE q."tournamentId" = $1 AND qm."winnerId" IS NOT NULL
         UNION
         SELECT qm."teamBId" AS team_id
         FROM qualification_match qm
         INNER JOIN qualification q ON q.id = qm."qualificationId"
         WHERE q."tournamentId" = $1 AND qm."winnerId" IS NOT NULL
       ) t`,
      [tournamentId],
    );
    return rows.map((r) => r.team_id);
  }

  /** Returns full Team entities for teams with at least one verified qualification match. */
  async findQualificationTeams(tournamentId: string): Promise<Team[]> {
    const ids = await this.findVerifiedQualificationTeamIds(tournamentId);
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
