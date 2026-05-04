import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Dota2Service, OpenDotaMatch } from '../dota2/dota2.service';
import { Player } from '../players/player.entity';
import { Team } from '../teams/team.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { TournamentDivision, TournamentStatus } from '../tournaments/tournaments.model';
import { QualificationMatch } from './qualification-match.entity';
import { QualificationMatchRepository } from './qualification-match.repository';
import { Qualification } from './qualification.entity';
import { QualificationRepository } from './qualification.repository';

const STEAM_ID_OFFSET = 76561197960265728n;
const MIN_MATCH_DURATION_SEC = 900;
const MAIN_PLAYERS_REQUIRED = 5;
const MAX_RESERVED_PLAYERS = 3;

function steamId64ToAccountId(steamId64: string): number {
  return Number(BigInt(steamId64) - STEAM_ID_OFFSET);
}

function computeDivision(mainPlayers: Player[]): TournamentDivision | null {
  const ratings = mainPlayers.map((p) => p.rating);
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  const max = Math.max(...ratings);

  if (avg <= 2500 && max <= 3500) return TournamentDivision.DIVISION_I;
  if (avg <= 4500 && max <= 5500) return TournamentDivision.DIVISION_II;
  if (avg <= 7000) return TournamentDivision.DIVISION_III;
  return null;
}

@Injectable()
export class QualificationService {
  constructor(
    private readonly qualRepo: QualificationRepository,
    private readonly qualMatchRepo: QualificationMatchRepository,
    private readonly dota2: Dota2Service,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async createForTournament(tournament: Tournament, nodeGroupId: string): Promise<Qualification> {
    const q = this.qualRepo.create({
      tournament,
      startTime: tournament.registrationStartsAt,
      endTime: tournament.registrationEndsAt,
      nodeGroupId,
    });
    return this.qualRepo.save(q);
  }

  async nextNodeGroupId(): Promise<string> {
    const result = await this.dataSource.query(
      "SELECT nextval('dota_node_group_seq') AS value",
    );
    return String(result[0].value);
  }

  async joinTournament(tournamentId: string, playerId: string): Promise<void> {
    const tournament = await this.dataSource.getRepository(Tournament).findOne({
      where: { id: tournamentId },
      relations: ['teams'],
    });
    if (!tournament) throw new NotFoundException('Турнір не знайдено');

    if (tournament.tournamentStatus !== TournamentStatus.REGISTRATION_OPEN) {
      throw new BadRequestException('Реєстрація на турнір закрита');
    }

    const team = await this.dataSource.getRepository(Team).findOne({
      where: { captain: { id: playerId } },
      relations: ['captain', 'mainPlayers', 'reservedPlayers', 'tournament'],
    });
    if (!team) {
      throw new ForbiddenException('Тільки капітан команди може приєднатися до турніру');
    }

    if (team.tournament !== null) {
      throw new BadRequestException('Команда вже бере участь у турнірі');
    }

    if (!team.isVerified) {
      throw new BadRequestException('Команда не верифікована');
    }

    if (!team.dotaTeamId) {
      throw new BadRequestException('Команда не має Dota2 Team ID');
    }

    const main = team.mainPlayers ?? [];
    if (main.length !== MAIN_PLAYERS_REQUIRED) {
      throw new BadRequestException(`Команда повинна мати рівно ${MAIN_PLAYERS_REQUIRED} основних гравців`);
    }

    const unverifiedMain = main.filter((p) => !p.verifiedAt);
    if (unverifiedMain.length > 0) {
      throw new BadRequestException('Всі основні гравці повинні бути верифіковані');
    }

    const teamDivision = computeDivision(main);
    if (!teamDivision) {
      throw new BadRequestException('Рейтинг команди виходить за межі дозволених дивізіонів');
    }
    if (teamDivision !== tournament.division) {
      throw new BadRequestException(
        `Дивізіон команди (${teamDivision}) не відповідає дивізіону турніру (${tournament.division})`,
      );
    }

    const reserved = team.reservedPlayers ?? [];
    if (reserved.length > MAX_RESERVED_PLAYERS) {
      throw new BadRequestException(`Дозволено не більше ${MAX_RESERVED_PLAYERS} запасних гравців`);
    }
    for (const sub of reserved) {
      if (!sub.verifiedAt) {
        throw new BadRequestException(`Запасний гравець ${sub.id} не верифікований`);
      }
      this.validateSubstitute(main, sub);
    }

    if (tournament.tournamentSlots !== null && tournament.tournamentSlots !== undefined) {
      const currentCount = (tournament.teams ?? []).length;
      if (currentCount >= tournament.tournamentSlots) {
        throw new BadRequestException('Усі місця в турнірі зайняті');
      }
    }

    const qualification = await this.qualRepo.findByTournamentId(tournamentId);
    if (!qualification) {
      throw new NotFoundException('Кваліфікацію турніру не знайдено');
    }

    const existingTeams = (qualification.matches ?? []).reduce<Team[]>((acc, m) => {
      if (!acc.find((t) => t.id === m.teamA.id)) acc.push(m.teamA);
      if (!acc.find((t) => t.id === m.teamB.id)) acc.push(m.teamB);
      return acc;
    }, []);

    await this.dota2.addNodeGroupTeam(qualification.nodeGroupId, team.dotaTeamId);

    const newMatches: QualificationMatch[] = [];
    for (const opponent of existingTeams) {
      if (!opponent.dotaTeamId) continue;

      const matchNodeGroupId = await this.nextNodeGroupId();
      await this.dota2.addNodeGroup({
        nodeGroupId: matchNodeGroupId,
        nodeGroupType: 7,
        teamCount: 2,
        containingNodeGroupId: qualification.nodeGroupId,
        phase: 0,
        defaultNodeType: 1,
      });
      await this.dota2.addNodeGroupTeam(qualification.nodeGroupId, opponent.dotaTeamId);

      const match = this.qualMatchRepo.create({
        qualification,
        teamA: team,
        teamB: opponent,
        winner: null,
        dotaMatchId: null,
        nodeGroupId: matchNodeGroupId,
      });
      newMatches.push(match);
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Team).save({ ...team, tournament, isPlayingTournament: true });
      if (newMatches.length > 0) {
        await manager.getRepository(QualificationMatch).save(newMatches);
      }
    });
  }

  async submitMatch(
    qualMatchId: string,
    dotaMatchId: string,
    playerId: string,
  ): Promise<QualificationMatch> {
    const qualMatch = await this.qualMatchRepo.findOneById(qualMatchId);
    if (!qualMatch) throw new NotFoundException('Матч не знайдено');

    const isCaptainA = qualMatch.teamA.captain?.id === playerId;
    const isCaptainB = qualMatch.teamB.captain?.id === playerId;

    if (!isCaptainA && !isCaptainB) {
      const teamA = await this.dataSource.getRepository(Team).findOne({
        where: { id: qualMatch.teamA.id },
        relations: ['captain'],
      });
      const teamB = await this.dataSource.getRepository(Team).findOne({
        where: { id: qualMatch.teamB.id },
        relations: ['captain'],
      });
      if (teamA?.captain?.id !== playerId && teamB?.captain?.id !== playerId) {
        throw new ForbiddenException('Тільки капітан однієї з команд може подати матч');
      }
    }

    if (qualMatch.dotaMatchId !== null) {
      throw new BadRequestException('Результат цього матчу вже подано');
    }

    const matchData = await this.dota2.getOpenDotaMatch(dotaMatchId);
    this.validateOpenDotaMatch(matchData, qualMatch);

    const radiantTeamId = String(matchData.radiant_team?.team_id ?? '');
    const direTeamId = String(matchData.dire_team?.team_id ?? '');

    const teamAIsRadiant =
      radiantTeamId === qualMatch.teamA.dotaTeamId ||
      direTeamId === qualMatch.teamB.dotaTeamId;

    const winner = matchData.radiant_win
      ? teamAIsRadiant
        ? qualMatch.teamA
        : qualMatch.teamB
      : teamAIsRadiant
        ? qualMatch.teamB
        : qualMatch.teamA;

    qualMatch.dotaMatchId = dotaMatchId;
    qualMatch.winner = winner;
    return this.qualMatchRepo.save(qualMatch);
  }

  private validateSubstitute(mainPlayers: Player[], sub: Player): void {
    const ratings = mainPlayers.map((p) => p.rating).sort((a, b) => a - b);
    const lowestIdx = 0;
    const modifiedRatings = [...ratings];
    modifiedRatings[lowestIdx] = sub.rating;

    const mockPlayers = modifiedRatings.map((r) => ({ rating: r }) as Player);
    const newDivision = computeDivision(mockPlayers);
    const originalDivision = computeDivision(mainPlayers);

    if (newDivision !== originalDivision) {
      throw new BadRequestException(
        `Запасний гравець ${sub.id} змінює дивізіон команди — заміна не дозволена`,
      );
    }
  }

  private validateOpenDotaMatch(
    match: OpenDotaMatch,
    qualMatch: QualificationMatch,
  ): void {
    if (match.human_players !== 10) {
      throw new UnprocessableEntityException(
        'У лобі матчу було не 10 гравців',
      );
    }

    if (match.duration <= MIN_MATCH_DURATION_SEC) {
      throw new UnprocessableEntityException(
        'Матч тривав менше 15 хвилин',
      );
    }

    const qualEndUnix = Math.floor(
      qualMatch.qualification.endTime.getTime() / 1000,
    );
    if (match.start_time + match.duration > qualEndUnix) {
      throw new UnprocessableEntityException(
        'Матч завершився після закінчення кваліфікаційного етапу',
      );
    }

    const radiantId = String(match.radiant_team?.team_id ?? '');
    const direId = String(match.dire_team?.team_id ?? '');
    const teamAId = qualMatch.teamA.dotaTeamId ?? '';
    const teamBId = qualMatch.teamB.dotaTeamId ?? '';

    const teamsMatch =
      (radiantId === teamAId && direId === teamBId) ||
      (radiantId === teamBId && direId === teamAId);
    if (!teamsMatch) {
      throw new UnprocessableEntityException(
        'ID команд у матчі не збігаються з очікуваними',
      );
    }

    const matchAccountIds = new Set(
      match.players.map((p) => p.account_id),
    );

    const allExpectedPlayers = [
      ...(qualMatch.teamA.mainPlayers ?? []),
      ...(qualMatch.teamB.mainPlayers ?? []),
    ];

    for (const player of allExpectedPlayers) {
      if (!player.steamId) continue;
      const accountId = steamId64ToAccountId(player.steamId);
      if (!matchAccountIds.has(accountId)) {
        throw new UnprocessableEntityException(
          `Гравець зі Steam ID ${player.steamId} не знайдений у матчі`,
        );
      }
    }
  }
}
