import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull } from 'typeorm';
import { Dota2Service, OpenDotaMatch } from '../dota2/dota2.service';
import { DueloService } from '../duelo/duelo.service';
import { Player } from '../players/player.entity';
import { Team } from '../teams/team.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { TournamentTeamPayment } from '../tournaments/tournament-team-payment.entity';
import { PaymentStatus } from '../tournaments/tournament-team-payment.model';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import {
  TournamentDivision,
  TournamentStatus,
} from '../tournaments/tournaments.model';
import {
  DIVISION_RULES,
  computeTeamAvgRating,
  isTeamEligibleForDivision,
} from '../tournaments/tournament-division.util';
import { QualificationMatch } from './qualification-match.entity';
import { QualificationMatchRepository } from './qualification-match.repository';
import { Qualification } from './qualification.entity';
import { QualificationRepository } from './qualification.repository';
import { QualificationResponseDto } from './dto/qualification-response.dto';

const STEAM_ID_OFFSET = 76561197960265728n;
const MIN_MATCH_DURATION_SEC = 900;
const MAX_RESERVED_PLAYERS = 3;

function steamId64ToAccountId(steamId64: string): number {
  return Number(BigInt(steamId64) - STEAM_ID_OFFSET);
}

@Injectable()
export class QualificationService {
  private readonly logger = new Logger(QualificationService.name);

  constructor(
    private readonly qualRepo: QualificationRepository,
    private readonly qualMatchRepo: QualificationMatchRepository,
    private readonly dota2: Dota2Service,
    private readonly duelo: DueloService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getByTournamentId(
    tournamentId: string,
  ): Promise<QualificationResponseDto> {
    const qualification = await this.qualRepo.findByTournamentId(tournamentId);
    if (!qualification)
      throw new NotFoundException('Кваліфікацію турніру не знайдено');

    const pointRows = await this.dataSource
      .getRepository(PlayerTournamentPoints)
      .find({
        where: { tournamentId },
        select: ['playerId', 'points'],
        order: { playerId: 'ASC' },
      });

    return Object.assign(qualification, {
      playerTournamentPoints: pointRows.map((r) => ({
        playerId: r.playerId,
        points: r.points,
      })),
    });
  }

  async createForTournament(
    tournament: Tournament,
    nodeGroupId: string,
  ): Promise<Qualification> {
    this.logger.log(
      `Creating qualification for tournament ${tournament.id} with nodeGroupId=${nodeGroupId}`,
    );
    const qualificationEndBound =
      QualificationService.qualificationEndBound(tournament);

    const q = this.qualRepo.create({
      tournament,
      startTime: tournament.registrationStartsAt,
      endTime: qualificationEndBound,
      nodeGroupId,
    });
    const saved = await this.qualRepo.save(q);
    this.logger.log(
      `Qualification created: id=${saved.id} nodeGroupId=${nodeGroupId}`,
    );
    return saved;
  }

  /**
   * Кінець кваліфікації — найраніший з двох моментів: закриття реєстрації або старт основного турніру.
   * Так OpenDota/перевірки матчів узгоджені з актуальними датами турніру, а не лише колонки реєстрації.
   */
  private static qualificationEndBound(t: Tournament): Date {
    return new Date(
      Math.min(t.registrationEndsAt.getTime(), t.tournamentStartsAt.getTime()),
    );
  }

  async syncQualificationWindowFromTournament(
    tournament: Tournament,
  ): Promise<void> {
    const qualification = await this.qualRepo.findByTournamentId(tournament.id);
    if (!qualification) return;
    qualification.startTime = tournament.registrationStartsAt;
    qualification.endTime =
      QualificationService.qualificationEndBound(tournament);
    await this.qualRepo.save(qualification);
    this.logger.log(
      `Qualification ${qualification.id}: synced window from tournament ${tournament.id}`,
    );
  }

  private async playerHasAdminRole(playerId: string): Promise<boolean> {
    const row = await this.dataSource.getRepository(Player).findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    return (row?.roles ?? []).some((r) => r.isAdminRole);
  }

  async joinTournament(
    tournamentId: string,
    playerId: string,
    requestedTeamId?: string,
  ): Promise<void> {
    const bypassEnv = process.env.BYPASS_TEAM_VERIFICATION === 'true';
    const isAdmin = await this.playerHasAdminRole(playerId);

    if (requestedTeamId && !bypassEnv && !isAdmin) {
      throw new ForbiddenException(
        'Лише адміністратор може вказувати teamId при приєднанні команди до турніру',
      );
    }

    const useExplicitTeamId = !!(requestedTeamId && (bypassEnv || isAdmin));

    /**
     * Explicit roster attach (admin `teamId` or dev bypass) skips normal captain rules:
     * verification, Dota slot ID, roster validation, substitute rules, division match.
     */
    const bypassParticipantChecks = bypassEnv || useExplicitTeamId;

    const tournament = await this.dataSource.getRepository(Tournament).findOne({
      where: { id: tournamentId },
      relations: ['teams'],
    });
    if (!tournament) throw new NotFoundException('Турнір не знайдено');

    if (
      !bypassEnv &&
      !(useExplicitTeamId && isAdmin) &&
      tournament.tournamentStatus !== TournamentStatus.QUALIFICATIONS
    ) {
      throw new BadRequestException('Реєстрація на турнір закрита');
    }

    const teamRepo = this.dataSource.getRepository(Team);
    const team = useExplicitTeamId
      ? await teamRepo.findOne({
          where: { id: requestedTeamId, disbandedAt: IsNull() },
          relations: [
            'captain',
            'mainPlayers',
            'reservedPlayers',
            'tournaments',
          ],
        })
      : await teamRepo.findOne({
          where: { captain: { id: playerId }, disbandedAt: IsNull() },
          relations: [
            'captain',
            'mainPlayers',
            'reservedPlayers',
            'tournaments',
          ],
        });

    if (!team) {
      throw useExplicitTeamId
        ? new NotFoundException('Команду не знайдено')
        : new ForbiddenException(
            'Тільки капітан команди може приєднатися до турніру',
          );
    }

    const alreadyInThisTournament = (team.tournaments ?? []).some(
      (t) => t.id === tournament.id,
    );
    if (alreadyInThisTournament) {
      throw new ConflictException('Команда вже зареєстрована на цей турнір');
    }

    /** Captains obey time-overlap restriction; admins attaching by teamId bypass it */
    if (!useExplicitTeamId) {
      const hasOverlappingOtherTournament = (team.tournaments ?? []).some(
        (t) =>
          t.id !== tournament.id &&
          t.tournamentStartsAt.getTime() <
            tournament.tournamentEndsAt.getTime() &&
          t.tournamentEndsAt.getTime() >
            tournament.tournamentStartsAt.getTime(),
      );
      if (hasOverlappingOtherTournament) {
        throw new ConflictException(
          'Команда вже бере участь у турнірі, що перетинається за часом',
        );
      }
    }

    if (!bypassParticipantChecks) {
      if (!team.isVerified) {
        throw new BadRequestException('Команда не верифікована');
      }

      if (!team.dotaTeamId) {
        throw new BadRequestException('Команда не має Dota2 Team ID');
      }

      const main = team.mainPlayers ?? [];

      const unverifiedMain = main.filter((p) => !p.verifiedAt);
      if (unverifiedMain.length > 0) {
        throw new BadRequestException(
          'Всі основні гравці повинні бути верифіковані',
        );
      }

      // An empty roster is checked separately: it is not an MMR problem, and the
      // all-players-verified check above passes vacuously on an empty list.
      if (!main.length) {
        throw new BadRequestException(
          'У складі команди немає основних гравців',
        );
      }

      if (
        tournament.division &&
        !isTeamEligibleForDivision(main, tournament.division)
      ) {
        throw new BadRequestException(
          this.divisionRejectionMessage(main, tournament.division),
        );
      }

      const reserved = team.reservedPlayers ?? [];
      if (reserved.length > MAX_RESERVED_PLAYERS) {
        throw new BadRequestException(
          `Дозволено не більше ${MAX_RESERVED_PLAYERS} запасних гравців`,
        );
      }
      for (const sub of reserved) {
        if (!sub.verifiedAt) {
          throw new BadRequestException(
            `Запасний гравець ${sub.id} не верифікований`,
          );
        }
        if (tournament.division) {
          this.validateSubstitute(main, sub, tournament.division);
        }
      }
    }

    /**
     * Entry-fee gate: a fee'd tournament requires a PAID payment record for this
     * team before the captain can join. Admin/dev-bypass registrations skip it.
     */
    if (!bypassParticipantChecks) {
      const entryFee = tournament.entryFee ?? 0;
      if (entryFee > 0) {
        const paidCount = await this.dataSource
          .getRepository(TournamentTeamPayment)
          .count({
            where: {
              tournamentId: tournament.id,
              teamId: team.id,
              status: PaymentStatus.PAID,
            },
          });
        if (paidCount === 0) {
          throw new HttpException(
            'Необхідно сплатити вступний внесок за участь у турнірі',
            HttpStatus.PAYMENT_REQUIRED,
          );
        }
      }
    }

    if (
      tournament.tournamentSlots !== null &&
      tournament.tournamentSlots !== undefined
    ) {
      const currentCount = (tournament.teams ?? []).length;
      if (currentCount >= tournament.tournamentSlots) {
        throw new ConflictException('Усі місця в турнірі зайняті');
      }
    }

    const qualification = await this.qualRepo.findByTournamentId(tournamentId);
    if (!qualification) {
      throw new NotFoundException('Кваліфікацію турніру не знайдено');
    }

    const existingTeams = (tournament.teams ?? []).filter(
      (t) => t.id !== team.id,
    );

    this.logger.log(
      `Team ${team.id} (dotaTeamId=${team.dotaTeamId}) joining qualification nodeGroupId=${qualification.nodeGroupId}`,
    );
    if (team.dotaTeamId) {
      await this.dota2.addNodeGroupTeam(
        qualification.nodeGroupId,
        team.dotaTeamId,
      );
      this.logger.log(
        `Team added to qualification stage nodeGroupId=${qualification.nodeGroupId}`,
      );
    } else {
      this.logger.warn(
        `Team ${team.id} has no dotaTeamId — skipping addNodeGroupTeam`,
      );
    }

    const newMatches: QualificationMatch[] = [];
    for (const opponent of existingTeams) {
      if (!opponent.dotaTeamId || !team.dotaTeamId) continue;

      this.logger.log(
        `Creating match node inside NodeGroup${qualification.nodeGroupId} (team=${team.dotaTeamId} vs opponent=${opponent.dotaTeamId})`,
      );
      await this.dota2.addNodeGroup({
        nodeGroupId: '',
        nodeGroupType: 2,
        teamCount: 2,
        containingNodeGroupId: qualification.nodeGroupId,
        phase: 0,
        defaultNodeType: 1,
      });
      const matchNodeGroupId = await this.dota2.resolveRoundRobinNodeGroupId(
        qualification.nodeGroupId,
      );
      this.logger.log(
        `Match node nodeGroupId=${matchNodeGroupId} (parsed from Dota2 page) — adding teams`,
      );
      await this.dota2.addNodeGroupTeam(matchNodeGroupId, team.dotaTeamId);
      this.logger.log(
        `Added team ${team.dotaTeamId} to match nodeGroupId=${matchNodeGroupId}`,
      );
      await this.dota2.addNodeGroupTeam(matchNodeGroupId, opponent.dotaTeamId);
      this.logger.log(
        `Added opponent ${opponent.dotaTeamId} to match nodeGroupId=${matchNodeGroupId}`,
      );

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
      await manager.query(
        `INSERT INTO "tournament_team" ("tournamentId", "teamId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [tournament.id, team.id],
      );
      await manager
        .getRepository(Team)
        .update({ id: team.id }, { isPlayingTournament: true });
      if (newMatches.length > 0) {
        await manager.getRepository(QualificationMatch).save(newMatches);
      }
    });
  }

  async leaveTournament(
    tournamentId: string,
    playerId: string,
    requestedTeamId?: string,
  ): Promise<void> {
    const bypassEnv = process.env.BYPASS_TEAM_VERIFICATION === 'true';
    const isAdmin = await this.playerHasAdminRole(playerId);

    if (requestedTeamId && !bypassEnv && !isAdmin) {
      throw new ForbiddenException(
        'Лише адміністратор може вказувати teamId при виходу команди з турніру',
      );
    }

    const useExplicitTeamId = !!(requestedTeamId && (bypassEnv || isAdmin));

    const teamRepo = this.dataSource.getRepository(Team);
    const team = useExplicitTeamId
      ? await teamRepo.findOne({
          where: { id: requestedTeamId, disbandedAt: IsNull() },
          relations: ['captain', 'mainPlayers', 'tournaments'],
        })
      : await teamRepo.findOne({
          where: { captain: { id: playerId }, disbandedAt: IsNull() },
          relations: ['captain', 'mainPlayers', 'tournaments'],
        });

    if (!team) {
      throw useExplicitTeamId
        ? new NotFoundException('Команду не знайдено')
        : new ForbiddenException('Тільки капітан команди може залишити турнір');
    }

    if (!team.tournaments?.some((t) => t.id === tournamentId)) {
      throw new BadRequestException('Команда не бере участі у цьому турнірі');
    }

    const qualification = await this.qualRepo.findByTournamentId(tournamentId);
    if (!qualification) {
      throw new NotFoundException('Кваліфікацію турніру не знайдено');
    }

    const unplayedMatches = (qualification.matches ?? []).filter(
      (m) =>
        m.dotaMatchId === null &&
        m.teamA != null &&
        m.teamB != null &&
        (m.teamA.id === team.id || m.teamB.id === team.id),
    );

    for (const match of unplayedMatches) {
      this.logger.log(
        `Removing unplayed match node group ${match.nodeGroupId} for leaving team ${team.id}`,
      );
      await this.dota2.removeNodeGroup(match.nodeGroupId);
    }

    const playerIds = (team.mainPlayers ?? []).map((p) => p.id);

    await this.dataSource.transaction(async (manager) => {
      if (unplayedMatches.length > 0) {
        await manager.getRepository(QualificationMatch).remove(unplayedMatches);
      }
      if (playerIds.length > 0) {
        await manager
          .getRepository(PlayerTournamentPoints)
          .delete({ tournamentId, playerId: In(playerIds) });
      }
      await manager.query(
        `DELETE FROM "tournament_team" WHERE "tournamentId" = $1 AND "teamId" = $2`,
        [tournamentId, team.id],
      );
      const remainingTournaments = (team.tournaments ?? []).filter(
        (t) => t.id !== tournamentId,
      );
      await manager
        .getRepository(Team)
        .update(
          { id: team.id },
          { isPlayingTournament: remainingTournaments.length > 0 },
        );
    });
  }

  async submitMatch(
    tournamentId: string,
    dotaMatchId: string,
    playerId: string,
  ): Promise<QualificationMatch> {
    const isAdmin = await this.playerHasAdminRole(playerId);
    const matchData = await this.dota2.getOpenDotaMatch(dotaMatchId);

    const radiantTeamId = String(
      matchData.radiant_team?.team_id ?? matchData.radiant_team_id ?? '',
    );
    const direTeamId = String(
      matchData.dire_team?.team_id ?? matchData.dire_team_id ?? '',
    );

    if (!radiantTeamId || !direTeamId) {
      throw new BadRequestException(
        'Матч не містить інформації про команди — переконайтеся що це офіційний ліговий матч',
      );
    }

    const qualMatch = await this.qualMatchRepo.findByTournamentAndDotaTeams(
      tournamentId,
      radiantTeamId,
      direTeamId,
    );
    if (!qualMatch) {
      throw new NotFoundException(
        'Кваліфікаційний матч для вказаних команд не знайдено або результат вже подано',
      );
    }

    if (!qualMatch.teamA || !qualMatch.teamB) {
      throw new BadRequestException(
        'Кваліфікаційний слот недоступний: запис про одну з команд видалено',
      );
    }

    // Admins may submit results regardless of qualification status/window and
    // without being captain of either team. Captains keep the original rules.
    if (!isAdmin) {
      if (
        qualMatch.qualification.tournament.tournamentStatus !==
        TournamentStatus.QUALIFICATIONS
      ) {
        throw new BadRequestException(
          'Подача матчів доступна лише під час кваліфікаційного етапу',
        );
      }

      const isCaptainA = qualMatch.teamA.captain?.id === playerId;
      const isCaptainB = qualMatch.teamB.captain?.id === playerId;

      if (!isCaptainA && !isCaptainB) {
        const teamA = await this.dataSource.getRepository(Team).findOne({
          where: { id: qualMatch.teamA.id, disbandedAt: IsNull() },
          relations: ['captain'],
        });
        const teamB = await this.dataSource.getRepository(Team).findOne({
          where: { id: qualMatch.teamB.id, disbandedAt: IsNull() },
          relations: ['captain'],
        });
        if (
          teamA?.captain?.id !== playerId &&
          teamB?.captain?.id !== playerId
        ) {
          throw new ForbiddenException(
            'Тільки капітан однієї з команд може подати матч',
          );
        }
      }

      if (new Date() > qualMatch.qualification.endTime) {
        throw new BadRequestException(
          'Кваліфікаційний етап завершено — подача матчів заборонена',
        );
      }
    }

    if (!qualMatch.teamA.tournaments?.some((t) => t.id === tournamentId)) {
      throw new BadRequestException(
        `Команда ${qualMatch.teamA.id} більше не бере участь у турнірі`,
      );
    }
    if (!qualMatch.teamB.tournaments?.some((t) => t.id === tournamentId)) {
      throw new BadRequestException(
        `Команда ${qualMatch.teamB.id} більше не бере участь у турнірі`,
      );
    }

    this.validateOpenDotaMatch(matchData, qualMatch);

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

    const loser =
      winner.id === qualMatch.teamA.id ? qualMatch.teamB : qualMatch.teamA;
    const winnerMainPlayers =
      winner.id === qualMatch.teamA.id
        ? qualMatch.teamA.mainPlayers
        : qualMatch.teamB.mainPlayers;
    const loserMainPlayers =
      loser.id === qualMatch.teamA.id
        ? qualMatch.teamA.mainPlayers
        : qualMatch.teamB.mainPlayers;

    qualMatch.dotaMatchId = dotaMatchId;
    qualMatch.winner = winner;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(QualificationMatch).save(qualMatch);
      await this.awardPoints(
        manager,
        winnerMainPlayers ?? [],
        tournamentId,
        100,
      );
      await this.awardPoints(manager, loserMainPlayers ?? [], tournamentId, 40);
    });

    void this.duelo.sendMatchResult(matchData, 'qualification');

    return qualMatch;
  }

  private async awardPoints(
    manager: import('typeorm').EntityManager,
    players: Player[],
    tournamentId: string,
    amount: number,
  ): Promise<void> {
    for (const player of players) {
      await manager.query(
        `INSERT INTO player_tournament_points ("playerId", "tournamentId", points)
         VALUES ($1, $2, $3)
         ON CONFLICT ("playerId", "tournamentId") DO UPDATE SET points = player_tournament_points.points + $3`,
        [player.id, tournamentId, amount],
      );
    }
  }

  /**
   * Explains WHY a roster failed a division. Average-out-of-range and
   * player-over-cap are different problems with different fixes, and a captain
   * cannot act on an undifferentiated rejection.
   */
  private divisionRejectionMessage(
    main: { rating: number }[],
    division: TournamentDivision,
  ): string {
    const rule = DIVISION_RULES[division];

    // Bound to a local so TypeScript narrows it inside the closure.
    const cap = rule.maxPlayerRating;
    if (cap !== null) {
      const overCap = main
        .map((p) => p.rating)
        .filter((rating) => rating > cap);
      if (overCap.length) {
        const highest = Math.round(Math.max(...overCap));
        return `Гравець з MMR ${highest} перевищує ліміт ${cap} для дивізіону «${rule.label}»`;
      }
    }

    const avg = computeTeamAvgRating(main);
    const avgRounded = avg === null ? 0 : Math.round(avg);
    return `Середній MMR команди (${avgRounded}) не підходить для дивізіону «${rule.label}»`;
  }

  /**
   * A sub may come in for ANY main player, so the roster must stay eligible for
   * the tournament's division under every possible swap. Checking two extremes
   * suffices, because eligibility decomposes:
   *   - the average is monotonic — replacing the lowest-rated starter maximises
   *     it, replacing the highest minimises it, and every other slot lands
   *     between those two;
   *   - the per-player cap needs no separate check: the sub appears in every
   *     candidate roster (it is the one player common to all five), so
   *     `isTeamEligibleForDivision` already tests it there on both extremes.
   * So if both extremes are eligible, all five are.
   *
   * Note this validates against the TOURNAMENT's division, not against the
   * team's division being unchanged: under play-up a sub may shift the team's
   * resolved division while the roster still satisfies the tournament it enters.
   */
  private validateSubstitute(
    mainPlayers: Player[],
    sub: Player,
    division: TournamentDivision,
  ): void {
    const ratings = mainPlayers.map((p) => p.rating).sort((a, b) => a - b);
    if (ratings.length === 0) return;

    const eligibleWithReplacementAt = (index: number) => {
      const modified = [...ratings];
      modified[index] = sub.rating;
      return isTeamEligibleForDivision(
        modified.map((rating) => ({ rating })),
        division,
      );
    };

    if (
      !eligibleWithReplacementAt(0) ||
      !eligibleWithReplacementAt(ratings.length - 1)
    ) {
      throw new BadRequestException(
        `Запасний гравець ${sub.id} не підходить для дивізіону турніру`,
      );
    }
  }

  private validateOpenDotaMatch(
    match: OpenDotaMatch,
    qualMatch: QualificationMatch,
  ): void {
    if (!qualMatch.teamA || !qualMatch.teamB) {
      throw new UnprocessableEntityException(
        'Кваліфікаційний слот пошкоджено — одну з команд видалено',
      );
    }

    if (match.human_players !== 10) {
      throw new UnprocessableEntityException('У лобі матчу було не 10 гравців');
    }

    if (match.duration <= MIN_MATCH_DURATION_SEC) {
      throw new UnprocessableEntityException('Матч тривав менше 15 хвилин');
    }

    const qualEndUnix = Math.floor(
      qualMatch.qualification.endTime.getTime() / 1000,
    );
    if (match.start_time + match.duration > qualEndUnix) {
      throw new UnprocessableEntityException(
        'Матч завершився після закінчення кваліфікаційного етапу',
      );
    }

    const radiantId = String(match.radiant_team_id ?? '');
    const direId = String(match.dire_team_id ?? '');
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

    // All roster players (main + reserve) for both teams
    const allRosterPlayers = [
      ...(qualMatch.teamA.mainPlayers ?? []),
      ...(qualMatch.teamA.reservedPlayers ?? []),
      ...(qualMatch.teamB.mainPlayers ?? []),
      ...(qualMatch.teamB.reservedPlayers ?? []),
    ];
    const allowedAccountIds = new Set(
      allRosterPlayers
        .filter((p) => p.steamId)
        .map((p) => steamId64ToAccountId(p.steamId!)),
    );

    for (const matchPlayer of match.players) {
      if (!allowedAccountIds.has(matchPlayer.account_id)) {
        throw new UnprocessableEntityException(
          `Гравець з account_id ${matchPlayer.account_id} не є учасником жодної з команд`,
        );
      }
    }
  }
}
