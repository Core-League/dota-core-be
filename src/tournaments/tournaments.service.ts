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
    const entity = this.tournamentsRepo.create(dto);
    const tournament = await this.tournamentsRepo.save(entity);

    this.logger.log(`Tournament ${tournament.id}: calling addNodeGroup for qualification stage (node_group_id empty, Dota2 auto-assigns)`);
    await this.dota2.addNodeGroup({
      nodeGroupId: '',
      nodeGroupType: 1,
      teamCount: 0,
      containingNodeGroupId: '0',
      phase: 2,
      defaultNodeType: 0,
    });
    const nodeGroupId = await this.qualificationService.nextNodeGroupId();
    this.logger.log(`Qualification stage nodeGroupId=${nodeGroupId} (Dota2 assigned)`);
    await this.qualificationService.createForTournament(tournament, nodeGroupId);

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
    await this.tournamentsRepo.remove(tournament);
  }
}
