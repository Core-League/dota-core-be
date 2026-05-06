import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Dota2Service } from '../dota2/dota2.service';
import { QualificationService } from '../qualification/qualification.service';
import { Tournament } from './tournaments.entity';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { TournamentsRepository } from './tournaments.repository';

@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    private readonly tournamentsRepo: TournamentsRepository,
    private readonly dota2: Dota2Service,
    private readonly qualificationService: QualificationService,
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

  async findOne(id: string): Promise<Tournament> {
    const tournament = await this.tournamentsRepo.findOneById(id);
    if (!tournament) {
      throw new NotFoundException('Турнір не знайдено');
    }
    return tournament;
  }

  async update(id: string, payload: Partial<Tournament>): Promise<Tournament> {
    const tournament = await this.findOne(id);
    Object.assign(tournament, payload);
    return this.tournamentsRepo.save(tournament);
  }

  async remove(id: string): Promise<void> {
    const tournament = await this.findOne(id);

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
}
