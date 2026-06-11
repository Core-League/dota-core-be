import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  And,
  DataSource,
  type EntityManager,
  LessThan,
  MoreThanOrEqual,
} from 'typeorm';
import { toVerificationRequest } from '../db/mappers/verification-request.mapper';
import { VerificationRequestPlayerModel } from '../db/models/verification-request-player.model';
import { VerificationRequestModel } from '../db/models/verification-request.model';
import { VerificationSlotModel } from '../db/models/verification-slot.model';
import type { VerificationRequest } from '../types/entities/verification/request';
import { VerificationRequestStatus } from '../types/enums/verification/VerificationRequestStatus';
import { VerificationSlotStatus } from '../types/enums/verification/VerificationSlotStatus';
import type {
  CreateBookingInput,
  IRequestRepository,
} from '../types/interfaced/repos/verification-request.repository.interface';

/** Persistence for v2-owned verification requests + their per-player rows. */
@Injectable()
export class RequestRepository implements IRequestRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Atomically book a free slot: locks the slot row, flips it to `booked`, and
   * inserts the request + player rows. Throws if the slot was taken in a race.
   */
  async createBooking(input: CreateBookingInput): Promise<VerificationRequest> {
    return this.dataSource.transaction(async (m) => {
      const slotRepo = m.getRepository(VerificationSlotModel);
      const slot = await slotRepo.findOne({
        where: { id: input.slotId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!slot) throw new NotFoundException('Slot not found');
      if (slot.status !== VerificationSlotStatus.Free) {
        throw new ConflictException('Slot is no longer free');
      }
      slot.status = VerificationSlotStatus.Booked;
      await slotRepo.save(slot);

      const reqRepo = m.getRepository(VerificationRequestModel);
      const saved = await reqRepo.save(
        reqRepo.create({
          teamId: input.teamId,
          slotId: input.slotId,
          type: input.type,
          status: VerificationRequestStatus.Pending,
          createdByPlayerId: input.createdByPlayerId,
        }),
      );

      const playerRepo = m.getRepository(VerificationRequestPlayerModel);
      await playerRepo.save(
        input.playerIds.map((playerId) =>
          playerRepo.create({ requestId: saved.id, playerId, resultMmr: null }),
        ),
      );

      return this.loadById(saved.id, m);
    });
  }

  async findById(id: string): Promise<VerificationRequest | null> {
    const model = await this.dataSource
      .getRepository(VerificationRequestModel)
      .findOne({ where: { id }, relations: { players: { player: true } } });
    return model ? toVerificationRequest(model) : null;
  }

  async findBySlotId(slotId: string): Promise<VerificationRequest | null> {
    const model = await this.dataSource
      .getRepository(VerificationRequestModel)
      .findOne({ where: { slotId }, relations: { players: { player: true } } });
    return model ? toVerificationRequest(model) : null;
  }

  /** Requests whose slot starts in `[from, to)` (the admin daily list). */
  async findInRange(from: Date, to: Date): Promise<VerificationRequest[]> {
    const models = await this.dataSource
      .getRepository(VerificationRequestModel)
      .find({
        where: { slot: { startsAt: And(MoreThanOrEqual(from), LessThan(to)) } },
        relations: { players: { player: true }, slot: true },
        order: { slot: { startsAt: 'ASC' } },
      });
    return models.map(toVerificationRequest);
  }

  async setStatus(
    id: string,
    status: VerificationRequestStatus,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = (manager ?? this.dataSource.manager).getRepository(
      VerificationRequestModel,
    );
    await repo.update(id, { status });
  }

  /** Write each player's resulting MMR onto its request row. */
  async setPlayerResults(
    requestId: string,
    results: { playerId: string; mmr: number }[],
    manager?: EntityManager,
  ): Promise<void> {
    const repo = (manager ?? this.dataSource.manager).getRepository(
      VerificationRequestPlayerModel,
    );
    for (const r of results) {
      await repo.update(
        { requestId, playerId: r.playerId },
        { resultMmr: r.mmr },
      );
    }
  }

  /** Run a unit of work in a transaction (used by request completion). */
  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  private async loadById(
    id: string,
    manager?: EntityManager,
  ): Promise<VerificationRequest> {
    const model = await (manager ?? this.dataSource.manager)
      .getRepository(VerificationRequestModel)
      .findOneOrFail({
        where: { id },
        relations: { players: { player: true } },
      });
    return toVerificationRequest(model);
  }
}
