import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { ChallongeService } from '../challonge/challonge.service';
import { Player } from '../players/player.entity';
import { PlayoffMatch } from '../playoff/playoff-match.entity';
import { Playoff } from '../playoff/playoff.entity';
import { QualificationMatch } from '../qualification/qualification-match.entity';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import { TournamentPlayoffTeam } from '../tournaments/tournament-playoff-team.entity';

@Injectable()
export class DevService {
  private readonly logger = new Logger(DevService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly challonge: ChallongeService,
  ) {}

  async mockQualificationMatch(
    tournamentId: string,
    teamAId: string,
    teamBId: string,
  ): Promise<QualificationMatch> {
    const repo = this.dataSource.getRepository(QualificationMatch);
    const match = await repo.findOne({
      where: [
        {
          dotaMatchId: IsNull(),
          qualification: { tournament: { id: tournamentId } },
          teamA: { id: teamAId },
          teamB: { id: teamBId },
        },
        {
          dotaMatchId: IsNull(),
          qualification: { tournament: { id: tournamentId } },
          teamA: { id: teamBId },
          teamB: { id: teamAId },
        },
      ],
      relations: [
        'qualification',
        'qualification.tournament',
        'teamA',
        'teamA.mainPlayers',
        'teamB',
        'teamB.mainPlayers',
        'winner',
      ],
    });

    if (!match) {
      throw new NotFoundException(
        'No unsubmitted qualification match found for these teams in this tournament',
      );
    }

    if (!match.teamA || !match.teamB) {
      throw new BadRequestException(
        'Qualification slot is missing one or both teams — cannot mock',
      );
    }

    const winner = Math.random() < 0.5 ? match.teamA : match.teamB;
    const loser = winner.id === match.teamA.id ? match.teamB : match.teamA;
    const winnerPlayers =
      winner.id === match.teamA.id
        ? match.teamA.mainPlayers
        : match.teamB.mainPlayers;
    const loserPlayers =
      loser.id === match.teamA.id
        ? match.teamA.mainPlayers
        : match.teamB.mainPlayers;

    match.dotaMatchId = `mock-${Date.now()}`;
    match.winner = winner;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(QualificationMatch).save(match);
      await this.awardPoints(manager, winnerPlayers ?? [], tournamentId, 100);
      await this.awardPoints(manager, loserPlayers ?? [], tournamentId, 40);
    });

    return match;
  }

  async mockPlayoffMatch(
    tournamentId: string,
    teamAId: string,
    teamBId: string,
  ): Promise<PlayoffMatch> {
    const playoff = await this.dataSource
      .getRepository(Playoff)
      .findOne({ where: { tournamentId } });
    if (!playoff) throw new NotFoundException('Playoff not found');

    const tptRepo = this.dataSource.getRepository(TournamentPlayoffTeam);
    const [teamARow, teamBRow] = await Promise.all([
      tptRepo.findOne({ where: { tournamentId, teamId: teamAId } }),
      tptRepo.findOne({ where: { tournamentId, teamId: teamBId } }),
    ]);

    if (!teamARow || !teamBRow) {
      throw new BadRequestException(
        'One or both teams are not playoff participants',
      );
    }

    this.logger.log(
      `mockPlayoffMatch: teamA challongeParticipantId=${teamARow.challongeParticipantId}, teamB challongeParticipantId=${teamBRow.challongeParticipantId}`,
    );

    const winnerTeamId = Math.random() < 0.5 ? teamAId : teamBId;
    const loserTeamId = winnerTeamId === teamAId ? teamBId : teamAId;
    const winnerRow = winnerTeamId === teamAId ? teamARow : teamBRow;
    const loserRow = loserTeamId === teamAId ? teamARow : teamBRow;

    const challongeMatch = await this.challonge.findOpenMatch(
      playoff.challongeUrl,
      Number(winnerRow.challongeParticipantId),
      Number(loserRow.challongeParticipantId),
    );

    const matchRepo = this.dataSource.getRepository(PlayoffMatch);
    const match = matchRepo.create({
      playoffId: playoff.id,
      teamAId: winnerTeamId,
      teamBId: loserTeamId,
      winnerId: winnerTeamId,
      dotaMatchId: `mock-${Date.now()}`,
      challongeMatchId: String(challongeMatch.id),
    });
    await matchRepo.save(match);

    const activeTeams = await tptRepo.count({
      where: { tournamentId, isDisqualified: false },
    });
    const teamCt =
      typeof activeTeams === 'bigint'
        ? Number(activeTeams)
        : Math.trunc(Number(activeTeams));

    const finalsBo3 = await this.challonge.getFinalBo3ChallongeMatchIds(
      playoff.challongeUrl,
      Number.isFinite(teamCt) ? teamCt : 0,
    );

    if (!finalsBo3.has(challongeMatch.id)) {
      await this.challonge.reportMatchResult(
        playoff.challongeUrl,
        challongeMatch.id,
        Number(winnerRow.challongeParticipantId),
        challongeMatch.player1_id,
        challongeMatch.player2_id,
      );
    } else {
      const allGames = await matchRepo.find({
        where: {
          playoffId: playoff.id,
          challongeMatchId: String(challongeMatch.id),
        },
      });

      const wins = new Map<string, number>();
      for (const g of allGames) {
        if (g.winnerId) wins.set(g.winnerId, (wins.get(g.winnerId) ?? 0) + 1);
      }

      const seriesWinnerId = [...wins.entries()].find(([, w]) => w >= 2)?.[0];
      if (seriesWinnerId) {
        const seriesWinnerRow =
          seriesWinnerId === winnerTeamId ? winnerRow : loserRow;
        const seriesLoserRow =
          seriesWinnerId === winnerTeamId ? loserRow : winnerRow;
        const seriesWinnerWins = wins.get(seriesWinnerId) ?? 0;
        const seriesLoserWins = wins.get(seriesLoserRow.teamId) ?? 0;

        await this.challonge.reportMatchResult(
          playoff.challongeUrl,
          challongeMatch.id,
          Number(seriesWinnerRow.challongeParticipantId),
          challongeMatch.player1_id,
          challongeMatch.player2_id,
          seriesWinnerWins,
          seriesLoserWins,
        );
      }
    }

    return match;
  }

  private async awardPoints(
    manager: EntityManager,
    players: Player[],
    tournamentId: string,
    amount: number,
  ): Promise<void> {
    const repo = manager.getRepository(PlayerTournamentPoints);
    for (const player of players) {
      const existing = await repo.findOne({
        where: { playerId: player.id, tournamentId },
      });
      if (existing) {
        existing.points += amount;
        await repo.save(existing);
      } else {
        await repo.save(
          repo.create({ playerId: player.id, tournamentId, points: amount }),
        );
      }
    }
  }
}
