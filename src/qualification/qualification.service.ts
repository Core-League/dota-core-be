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
import { MatchParticipantsService } from '../match-participants/match-participants.service';
import { Player } from '../players/player.entity';
import { Team } from '../teams/team.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { TournamentTeamPayment } from '../tournaments/tournament-team-payment.entity';
import { PaymentStatus } from '../tournaments/tournament-team-payment.model';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import {
  TournamentStatus,
  isJoinableStatus,
} from '../tournaments/tournaments.model';
import {
  getRegistrationBlockReason,
  registrationBlockMessage,
} from '../tournaments/tournament-registration.util';
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
    private readonly matchParticipants: MatchParticipantsService,
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

  /** True once the tournament has a qualification stage (and so a node group in its Dota league). */
  async existsForTournament(tournamentId: string): Promise<boolean> {
    return this.qualRepo.existsByTournamentId(tournamentId);
  }

  async createForTournament(
    tournament: Tournament,
    nodeGroupId: string,
  ): Promise<Qualification> {
    this.logger.log(
      `Creating qualification for tournament ${tournament.id} with nodeGroupId=${nodeGroupId}`,
    );
    const { qualificationStartsAt, qualificationEndsAt } = tournament;
    // Інваріант: етап створюють лише для турнірів із кваліфікацією, а в них
    // вікно завжди задане (`validateQualificationConfig` + DTO).
    if (!qualificationStartsAt || !qualificationEndsAt) {
      throw new Error(
        `Tournament ${tournament.id} has no qualification window; ` +
          'createForTournament must not be called for a tournament without a qualification stage',
      );
    }
    const q = this.qualRepo.create({
      tournament,
      startTime: qualificationStartsAt,
      endTime: qualificationEndsAt,
      nodeGroupId,
    });
    const saved = await this.qualRepo.save(q);
    this.logger.log(
      `Qualification created: id=${saved.id} nodeGroupId=${nodeGroupId}`,
    );
    return saved;
  }

  /**
   * Вікно подачі кваліфікаційних матчів дзеркалить власні колонки турніру
   * `qualificationStartsAt`/`qualificationEndsAt`. Раніше воно виводилося з дат
   * реєстрації, через що зсув дедлайну реєстрації мовчки обрізав подачу матчів.
   * Узгодженість із плей-оф гарантує `validateTournamentSchedule`.
   */
  async syncQualificationWindowFromTournament(
    tournament: Tournament,
  ): Promise<void> {
    const { qualificationStartsAt, qualificationEndsAt } = tournament;
    // Турнір без кваліфікації не має ні вікна, ні рядка `Qualification`.
    if (!qualificationStartsAt || !qualificationEndsAt) return;

    const qualification = await this.qualRepo.findByTournamentId(tournament.id);
    if (!qualification) return;
    qualification.startTime = qualificationStartsAt;
    qualification.endTime = qualificationEndsAt;
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

    const enforceRegistrationRules =
      !bypassEnv && !(useExplicitTeamId && isAdmin);

    /**
     * Приєднатися можна і під час реєстрації, і під час кваліфікації —
     * вікно реєстрації свідомо може заходити в кваліфікацію. Чи відкрита
     * реєстрація насправді, вирішують дати (перевірка нижче).
     * Повідомлення має лишатися байт-у-байт таким, як його зіставляє фронт
     * (`joinFriendlyHintFromApi` у Tournament.vue).
     */
    if (
      enforceRegistrationRules &&
      !isJoinableStatus(tournament.tournamentStatus)
    ) {
      throw new BadRequestException('Реєстрація на турнір закрита');
    }

    /** Реєстраційне вікно та ручне закриття адміном — лише для капітанів. */
    if (enforceRegistrationRules) {
      const blockReason = getRegistrationBlockReason(tournament);
      if (blockReason) {
        throw new BadRequestException(registrationBlockMessage(blockReason));
      }
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

    this.assertTeamCanJoin(tournament, team, {
      /** Captains obey time-overlap restriction; admins attaching by teamId bypass it */
      skipOverlapCheck: useExplicitTeamId,
      skipParticipantChecks: bypassParticipantChecks,
    });

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

    /**
     * Турнір без кваліфікації не має ні рядка `Qualification`, ні етапу в
     * Dota2 — команду просто реєструємо. Матчі кваліфікації створюємо лише
     * коли етап існує.
     */
    const newMatches: QualificationMatch[] = tournament.hasQualification
      ? await this.attachTeamToQualificationStage(tournament, team)
      : [];

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

  /**
   * Adds the team to the tournament's Dota2 qualification stage and builds one
   * fixture (and its unsaved `QualificationMatch` row) against every team
   * already registered. Only for tournaments with `hasQualification`.
   * `tournament` must carry `teams`.
   */
  private async attachTeamToQualificationStage(
    tournament: Tournament,
    team: Team,
  ): Promise<QualificationMatch[]> {
    const qualification = await this.qualRepo.findByTournamentId(tournament.id);
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
        tournament.dotaLeagueId,
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
    const createdNodeGroupIds: string[] = [];
    for (const opponent of existingTeams) {
      if (!opponent.dotaTeamId || !team.dotaTeamId) continue;

      this.logger.log(
        `Creating match node inside NodeGroup${qualification.nodeGroupId} (team=${team.dotaTeamId} vs opponent=${opponent.dotaTeamId})`,
      );
      const matchNodeGroupId = await this.dota2.createTwoTeamFixtureNode(
        tournament.dotaLeagueId,
        qualification.nodeGroupId,
        team.dotaTeamId,
        opponent.dotaTeamId,
        `${team.name} vs ${opponent.name}`,
      );
      this.logger.log(
        `Match node nodeGroupId=${matchNodeGroupId} created with both teams`,
      );
      createdNodeGroupIds.push(matchNodeGroupId);

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

    /**
     * Guard against the failure that produced a whole qualification of
     * unpickable matches: teams attached to the group but never bound to its
     * node. The join itself still succeeds — admins can record results by
     * hand — but the breakage must not pass unnoticed again.
     */
    const unplayable = await this.dota2.findUnplayableFixtureNodeGroups(
      tournament.dotaLeagueId,
      createdNodeGroupIds,
    );
    if (unplayable.length > 0) {
      this.logger.error(
        `Dota fixtures created without teams bound to their node — these matches ` +
          `cannot be selected when creating a lobby: NodeGroup${unplayable.join(', NodeGroup')}`,
      );
    }

    return newMatches;
  }

  /**
   * Registers a team whose entry fee has just been confirmed, acting as its
   * captain. Called from the acquiring callback so a paid team lands in the
   * tournament without a second click. Goes through `joinTournament` so the
   * captain rules — and the PAID gate, now satisfied — apply unchanged.
   */
  async joinTournamentAsPaidTeam(
    tournamentId: string,
    teamId: string,
  ): Promise<void> {
    const team = await this.dataSource.getRepository(Team).findOne({
      where: { id: teamId, disbandedAt: IsNull() },
      relations: ['captain'],
    });
    if (!team?.captain) {
      throw new NotFoundException('Команду не знайдено');
    }
    await this.joinTournament(tournamentId, team.captain.id);
  }

  /**
   * Team-level reasons a join would be refused: already registered, schedule
   * overlap, unverified, no Dota team, invalid roster, no free slot. Throws the
   * same HTTP errors the join endpoint always threw.
   *
   * Runs both on the join itself and before an entry-fee invoice is minted,
   * so a captain cannot pay for a tournament their team would then be refused
   * from — after payment the team is registered automatically, and a refusal
   * at that point would mean a refund.
   *
   * `tournament` must carry `teams`; `team` must carry `tournaments`,
   * `mainPlayers` and `reservedPlayers`.
   */
  assertTeamCanJoin(
    tournament: Tournament,
    team: Team,
    options: {
      skipOverlapCheck?: boolean;
      skipParticipantChecks?: boolean;
    } = {},
  ): void {
    const alreadyInThisTournament = (team.tournaments ?? []).some(
      (t) => t.id === tournament.id,
    );
    if (alreadyInThisTournament) {
      throw new ConflictException('Команда вже зареєстрована на цей турнір');
    }

    if (!options.skipOverlapCheck) {
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

    if (!options.skipParticipantChecks) {
      if (!team.isVerified) {
        throw new BadRequestException('Команда не верифікована');
      }

      if (!team.dotaTeamId) {
        throw new BadRequestException('Команда не має Dota2 Team ID');
      }

      this.validateRoster(team.mainPlayers ?? [], team.reservedPlayers ?? []);
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

    /**
     * Турнір без кваліфікації рядка `Qualification` не має — знімати
     * матчі нічого, лише прибираємо реєстрацію.
     */
    const qualification = await this.qualRepo.findByTournamentId(tournamentId);
    const unplayedMatches = (qualification?.matches ?? []).filter(
      (m) =>
        m.dotaMatchId === null &&
        m.teamA != null &&
        m.teamB != null &&
        (m.teamA.id === team.id || m.teamB.id === team.id),
    );

    // `findByTournamentId` loads the `tournament` relation, so the league the
    // match nodes live in is known whenever there is anything to remove.
    if (qualification && unplayedMatches.length > 0) {
      const leagueId = qualification.tournament.dotaLeagueId;
      for (const match of unplayedMatches) {
        this.logger.log(
          `Removing unplayed match node group ${match.nodeGroupId} for leaving team ${team.id}`,
        );
        await this.dota2.removeNodeGroup(leagueId, match.nodeGroupId);
      }
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

      const now = new Date();
      if (now < qualMatch.qualification.startTime) {
        throw new BadRequestException(
          'Кваліфікаційний етап ще не розпочався — подача матчів недоступна',
        );
      }
      if (now > qualMatch.qualification.endTime) {
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

    // Who really played (player stats). Never fails the submission.
    await this.matchParticipants.recordFromDota(
      {
        stage: 'qualification',
        matchId: qualMatch.id,
        tournamentId,
        dotaMatchId,
        teamAId: qualMatch.teamA.id,
        teamBId: qualMatch.teamB.id,
        winnerId: winner.id,
      },
      matchData,
    );

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
   * Roster rules for joining. Tournaments are open entry — there is no MMR
   * bound and no per-player cap, so rating never appears here.
   */
  private validateRoster(main: Player[], reserved: Player[]): void {
    const unverifiedMain = main.filter((p) => !p.verifiedAt);
    if (unverifiedMain.length > 0) {
      throw new BadRequestException(
        'Всі основні гравці повинні бути верифіковані',
      );
    }

    // An empty roster is checked separately: the all-players-verified check
    // above passes vacuously on an empty list.
    if (!main.length) {
      throw new BadRequestException('У складі команди немає основних гравців');
    }

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

    /**
     * Матч має повністю вміщатися у вікно кваліфікації. Верхню межу перевіряли
     * й раніше; нижня зʼявилася разом з окремою колонкою `qualificationStartsAt`
     * — без неї можна було подати матч, зіграний задовго до старту етапу.
     */
    const qualStartUnix = Math.floor(
      qualMatch.qualification.startTime.getTime() / 1000,
    );
    if (match.start_time < qualStartUnix) {
      throw new UnprocessableEntityException(
        'Матч розпочався до початку кваліфікаційного етапу',
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
