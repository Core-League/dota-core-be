import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Dota2Service } from '../dota2/dota2.service';
import { QualificationService } from '../qualification/qualification.service';
import { Tournament } from './tournaments.entity';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { TournamentsRepository } from './tournaments.repository';
import { TournamentPlayoffTeamRepository } from './tournament-playoff-team.repository';
import { TeamsService } from '../teams/teams.service';
import { TeamResponseDto } from '../teams/dto/team-response.dto';
import { validateQualificationConfig } from './tournament-qualification.util';
import { validateBracketConfig } from './tournament-bracket.util';
import {
  DEFAULT_FINAL_BEST_OF,
  DEFAULT_TOURNAMENT_BRACKET_TYPE,
} from './tournaments.model';
import { PlayoffRepository } from '../playoff/playoff.repository';
import {
  QUALIFICATION_WINDOW_KEYS,
  TTournamentSchedule,
  validateTournamentSchedule,
} from './tournament-schedule.util';

@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    private readonly tournamentsRepo: TournamentsRepository,
    private readonly playoffTeamRepo: TournamentPlayoffTeamRepository,
    private readonly dota2: Dota2Service,
    private readonly qualificationService: QualificationService,
    private readonly teamsService: TeamsService,
    private readonly playoffRepo: PlayoffRepository,
  ) {}

  async create(dto: CreateTournamentDto): Promise<Tournament> {
    // Відсутній прапорець означає «з кваліфікацією» — так поводяться старі клієнти.
    const hasQualification = dto.hasQualification !== false;

    const schedule: TTournamentSchedule = {
      registrationStartsAt: new Date(dto.registrationStartsAt),
      registrationEndsAt: new Date(dto.registrationEndsAt),
      qualificationStartsAt: hasQualification
        ? new Date(dto.qualificationStartsAt as string)
        : null,
      qualificationEndsAt: hasQualification
        ? new Date(dto.qualificationEndsAt as string)
        : null,
      tournamentStartsAt: new Date(dto.tournamentStartsAt),
      tournamentEndsAt: new Date(dto.tournamentEndsAt),
    };
    validateTournamentSchedule(schedule);
    validateQualificationConfig({
      hasQualification,
      tournamentSlots: dto.tournamentSlots,
      tournamentStatus: dto.tournamentStatus,
    });

    // Відсутній формат означає double elimination — єдиний формат, який знали старі клієнти.
    const bracket = {
      bracketType: dto.bracketType ?? DEFAULT_TOURNAMENT_BRACKET_TYPE,
      // Відсутній прапорець означає «без матчу за третє місце» — так було до його появи.
      hasThirdPlaceMatch: dto.hasThirdPlaceMatch ?? false,
      // Відсутній формат фіналу означає BO3 — так грали всі фінали до появи налаштування.
      upperBracketFinalBestOf:
        dto.upperBracketFinalBestOf ?? DEFAULT_FINAL_BEST_OF,
      lowerBracketFinalBestOf:
        dto.lowerBracketFinalBestOf ?? DEFAULT_FINAL_BEST_OF,
      grandFinalBestOf: dto.grandFinalBestOf ?? DEFAULT_FINAL_BEST_OF,
    };
    validateBracketConfig(bracket);

    const entity = this.tournamentsRepo.create({
      ...dto,
      ...schedule,
      hasQualification,
      ...bracket,
    });
    const tournament = await this.tournamentsRepo.save(entity);

    /**
     * Без кваліфікації немає ні етапу в Dota2, ні рядка `Qualification`:
     * турнір іде REGISTRATION → PLAYOFF, а сітку стартує
     * `TournamentPlayoffScheduler` о `tournamentStartsAt`.
     */
    if (!hasQualification) {
      this.logger.log(
        `Tournament ${tournament.id}: created without a qualification stage`,
      );
      return tournament;
    }

    this.logger.log(
      `Tournament ${tournament.id}: calling addNodeGroup for qualification stage`,
    );
    await this.dota2.addNodeGroup(tournament.dotaLeagueId, {
      nodeGroupId: '',
      nodeGroupType: 1,
      teamCount: 0,
      containingNodeGroupId: '0',
      phase: 2,
      defaultNodeType: 0,
    });
    const nodeGroupId = await this.dota2.resolveOrganizationalNodeGroupId(
      tournament.dotaLeagueId,
    );
    this.logger.log(
      `Qualification stage nodeGroupId=${nodeGroupId} in league ${tournament.dotaLeagueId} (parsed from Dota2 page)`,
    );
    await this.qualificationService.createForTournament(
      tournament,
      nodeGroupId,
    );

    return tournament;
  }

  findAll(): Promise<Tournament[]> {
    return this.tournamentsRepo.findAll();
  }

  private async findOneEntity(id: string): Promise<Tournament> {
    const tournament = await this.tournamentsRepo.findOneById(id);
    if (!tournament) {
      throw new NotFoundException('Турнір не знайдено');
    }
    return tournament;
  }

  async findOne(id: string) {
    const tournament = await this.findOneEntity(id);
    return {
      ...tournament,
      teams: (tournament.teams ?? []).map((t) =>
        this.teamsService.toTeamResponse(t),
      ),
    };
  }

  async update(id: string, payload: Partial<Tournament>): Promise<Tournament> {
    const tournament = await this.findOneEntity(id);

    /**
     * Форма сітки (формат і матч за третє місце) зафіксована, щойно існує
     * рядок `playoff` — незалежно від статусу турніру: жива сітка на Challonge
     * має рівно одну форму, і турнір не може мовчки з нею розійтися. Те саме
     * значення, що вже збережене, — не зміна, тож приймаємо його без перевірки.
     */
    const bracketFields = [
      'bracketType',
      'hasThirdPlaceMatch',
      'upperBracketFinalBestOf',
      'lowerBracketFinalBestOf',
      'grandFinalBestOf',
    ] as const;
    const bracketChanged = bracketFields.some(
      (field) =>
        payload[field] !== undefined && payload[field] !== tournament[field],
    );
    if (bracketChanged && (await this.playoffRepo.existsByTournamentId(id))) {
      throw new BadRequestException(
        'Форму сітки не можна змінити: плей-оф уже створено. ' +
          'Залиште поточні налаштування або перезапустіть плей-оф.',
      );
    }

    /**
     * Ліга Dota 2 зафіксована, щойно в ній створено хоч одну групу турніру:
     * етап кваліфікації (рядок `Qualification`, створюється разом із турніром)
     * або оболонку плей-оф (рядок `playoff`). Valve не дає перенести групи
     * між лігами, тож зміна ліги лишила б їх осиротілими в старій лізі.
     */
    const leagueChanged =
      payload.dotaLeagueId !== undefined &&
      payload.dotaLeagueId !== tournament.dotaLeagueId;
    if (leagueChanged) {
      const hasQualificationStage =
        await this.qualificationService.existsForTournament(id);
      const hasPlayoff = await this.playoffRepo.existsByTournamentId(id);
      if (hasQualificationStage || hasPlayoff) {
        throw new BadRequestException(
          'Лігу Dota 2 не можна змінити: у поточній лізі вже створено групи турніру ' +
            '(етап кваліфікації або плей-оф).',
        );
      }
    }

    // Перевіряємо підсумкову форму сітки: зміна лише формату не має лишити
    // матч за третє місце на double elimination.
    validateBracketConfig({
      bracketType: payload.bracketType ?? tournament.bracketType,
      hasThirdPlaceMatch:
        payload.hasThirdPlaceMatch ?? tournament.hasThirdPlaceMatch,
      upperBracketFinalBestOf:
        payload.upperBracketFinalBestOf ?? tournament.upperBracketFinalBestOf,
      lowerBracketFinalBestOf:
        payload.lowerBracketFinalBestOf ?? tournament.lowerBracketFinalBestOf,
      grandFinalBestOf: payload.grandFinalBestOf ?? tournament.grandFinalBestOf,
    });

    /**
     * Валідуємо підсумковий розклад, а не лише прислані поля: зсув однієї дати
     * не має залишити турнір із суперечливими вікнами (напр. кваліфікація, що
     * триває після старту плей-оф).
     */
    validateTournamentSchedule({ ...tournament, ...payload });

    /**
     * Етап зафіксований при створенні, тож турнір без кваліфікації не може
     * відростити її вікно через PATCH: дати лишилися б без самого етапу —
     * ні рядка `Qualification`, ні вкладки на фронті.
     */
    if (
      !tournament.hasQualification &&
      QUALIFICATION_WINDOW_KEYS.some((k) => payload[k] !== undefined)
    ) {
      throw new BadRequestException(
        'Турнір без кваліфікації не має вікна кваліфікації',
      );
    }

    validateQualificationConfig({
      hasQualification: tournament.hasQualification,
      tournamentSlots:
        payload.tournamentSlots !== undefined
          ? payload.tournamentSlots
          : tournament.tournamentSlots,
      tournamentStatus: payload.tournamentStatus ?? tournament.tournamentStatus,
    });

    Object.assign(tournament, payload);
    const saved = await this.tournamentsRepo.save(tournament);

    /**
     * Вікно подачі кваліфікаційних матчів тепер має власні колонки, тож
     * пересинхронізовуємо `Qualification` лише коли змінили саме їх. Правки
     * дат реєстрації більше не рухають дедлайн подачі матчів.
     */
    const shouldSyncQualification =
      tournament.hasQualification &&
      QUALIFICATION_WINDOW_KEYS.some((k) => payload[k] !== undefined);
    if (shouldSyncQualification) {
      await this.qualificationService.syncQualificationWindowFromTournament(
        saved,
      );
    }

    return saved;
  }

  /**
   * Ручне закриття реєстрації адміном до настання `registrationEndsAt`.
   * Торкається лише вікна реєстрації: кваліфікація має власні дати
   * (`qualificationStartsAt`/`qualificationEndsAt`), тож подача матчів триває.
   */
  async closeRegistration(id: string) {
    const tournament = await this.findOneEntity(id);
    if (!tournament.registrationClosedAt) {
      await this.tournamentsRepo.updateRegistrationClosedAt(id, new Date());
      this.logger.log(`Tournament ${id}: registration closed by admin`);
    }
    return this.findOne(id);
  }

  /** Повторне відкриття реєстрації: діють лише планові дати. */
  async openRegistration(id: string) {
    const tournament = await this.findOneEntity(id);
    if (tournament.registrationClosedAt) {
      await this.tournamentsRepo.updateRegistrationClosedAt(id, null);
      this.logger.log(`Tournament ${id}: registration reopened by admin`);
    }
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const tournament = await this.findOneEntity(id);

    try {
      const qualification =
        await this.qualificationService.getByTournamentId(id);

      for (const match of qualification.matches ?? []) {
        this.logger.log(`Removing Dota2 match node group ${match.nodeGroupId}`);
        await this.dota2.removeNodeGroup(
          tournament.dotaLeagueId,
          match.nodeGroupId,
        );
      }

      this.logger.log(
        `Removing Dota2 qualification node group ${qualification.nodeGroupId} for tournament ${id}`,
      );
      await this.dota2.removeNodeGroup(
        tournament.dotaLeagueId,
        qualification.nodeGroupId,
      );
    } catch {
      this.logger.warn(
        `No qualification found for tournament ${id} — skipping Dota2 node group removal`,
      );
    }

    await this.tournamentsRepo.remove(tournament);
  }

  async getQualificationTeams(
    tournamentId: string,
  ): Promise<TeamResponseDto[]> {
    await this.findOneEntity(tournamentId);
    const teams =
      await this.playoffTeamRepo.findQualificationTeams(tournamentId);
    return teams.map((t) => this.teamsService.toTeamResponse(t));
  }

  async getPlayoffTeams(tournamentId: string): Promise<TeamResponseDto[]> {
    await this.findOneEntity(tournamentId);
    const rows = await this.playoffTeamRepo.findByTournamentId(tournamentId);
    return rows.map((row) => this.teamsService.toTeamResponse(row.team));
  }

  async addPlayoffTeams(
    tournamentId: string,
    teamIds: string[] = [],
  ): Promise<TeamResponseDto[]> {
    await this.findOneEntity(tournamentId);

    const eligibleIds =
      await this.playoffTeamRepo.findEligibleQualificationTeamIds(tournamentId);
    const eligibleSet = new Set(eligibleIds);
    const invalid = teamIds.filter((id) => !eligibleSet.has(id));
    if (invalid.length) {
      throw new BadRequestException(
        `Teams must be registered for this tournament or present in its qualification bracket: ${invalid.join(', ')}`,
      );
    }

    await this.playoffTeamRepo.addTeams(tournamentId, teamIds);
    return this.getPlayoffTeams(tournamentId);
  }

  async removePlayoffTeams(
    tournamentId: string,
    teamIds: string[] = [],
  ): Promise<TeamResponseDto[]> {
    await this.findOneEntity(tournamentId);
    await this.playoffTeamRepo.removeTeams(tournamentId, teamIds);
    return this.getPlayoffTeams(tournamentId);
  }
}
