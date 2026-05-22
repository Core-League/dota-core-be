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

@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    private readonly tournamentsRepo: TournamentsRepository,
    private readonly playoffTeamRepo: TournamentPlayoffTeamRepository,
    private readonly dota2: Dota2Service,
    private readonly qualificationService: QualificationService,
    private readonly teamsService: TeamsService,
  ) {}

  async create(dto: CreateTournamentDto): Promise<Tournament> {
    const entity = this.tournamentsRepo.create({
      ...dto,
      registrationStartsAt: new Date(dto.registrationStartsAt),
      registrationEndsAt: new Date(dto.registrationEndsAt),
      tournamentStartsAt: new Date(dto.tournamentStartsAt),
      tournamentEndsAt: new Date(dto.tournamentEndsAt),
    });
    const tournament = await this.tournamentsRepo.save(entity);

    this.logger.log(
      `Tournament ${tournament.id}: calling addNodeGroup for qualification stage`,
    );
    await this.dota2.addNodeGroup({
      nodeGroupId: '',
      nodeGroupType: 1,
      teamCount: 0,
      containingNodeGroupId: '0',
      phase: 2,
      defaultNodeType: 0,
    });
    const nodeGroupId = await this.dota2.resolveOrganizationalNodeGroupId();
    this.logger.log(
      `Qualification stage nodeGroupId=${nodeGroupId} (parsed from Dota2 page)`,
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
    Object.assign(tournament, payload);
    const saved = await this.tournamentsRepo.save(tournament);

    const qualDateKeys: Array<
      keyof Pick<
        Tournament,
        'registrationStartsAt' | 'registrationEndsAt' | 'tournamentStartsAt'
      >
    > = ['registrationStartsAt', 'registrationEndsAt', 'tournamentStartsAt'];
    const shouldSyncQualification = qualDateKeys.some(
      (k) => payload[k] !== undefined,
    );
    if (shouldSyncQualification) {
      await this.qualificationService.syncQualificationWindowFromTournament(
        saved,
      );
    }

    return saved;
  }

  async remove(id: string): Promise<void> {
    const tournament = await this.findOneEntity(id);

    try {
      const qualification =
        await this.qualificationService.getByTournamentId(id);

      for (const match of qualification.matches ?? []) {
        this.logger.log(`Removing Dota2 match node group ${match.nodeGroupId}`);
        await this.dota2.removeNodeGroup(match.nodeGroupId);
      }

      this.logger.log(
        `Removing Dota2 qualification node group ${qualification.nodeGroupId} for tournament ${id}`,
      );
      await this.dota2.removeNodeGroup(qualification.nodeGroupId);
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
