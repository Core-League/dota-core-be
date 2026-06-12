import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  type EntityManager,
  In,
  LessThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { toVerificationSlot } from '../db/mappers/verification-slot.mapper';
import { VerificationSlotModel } from '../db/models/verification-slot.model';
import type { VerificationSlot } from '../types/entities/verification/slot';
import { VerificationSlotStatus } from '../types/enums/verification/VerificationSlotStatus';
import type { ISlotRepository } from '../types/interfaced/repos/verification-slot.repository.interface';

/** Persistence for v2-owned verification calendar slots. */
@Injectable()
export class SlotRepository implements ISlotRepository {
  constructor(
    @InjectRepository(VerificationSlotModel)
    private readonly repo: Repository<VerificationSlotModel>,
  ) {}

  async createMany(
    slots: { startsAt: Date; endsAt: Date }[],
  ): Promise<VerificationSlot[]> {
    if (slots.length === 0) return [];
    const models = slots.map((s) =>
      this.repo.create({
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: VerificationSlotStatus.Free,
      }),
    );
    const saved = await this.repo.save(models);
    return saved.map(toVerificationSlot);
  }

  /** Slots whose `startsAt` falls in `[from, to)`, optionally filtered by status. */
  async findInRange(
    from: Date,
    to: Date,
    statuses?: VerificationSlotStatus[],
  ): Promise<VerificationSlot[]> {
    const models = await this.repo.find({
      where: {
        startsAt: And(MoreThanOrEqual(from), LessThan(to)),
        ...(statuses?.length ? { status: In(statuses) } : {}),
      },
      order: { startsAt: 'ASC' },
    });
    return models.map(toVerificationSlot);
  }

  async findById(id: string): Promise<VerificationSlot | null> {
    const model = await this.repo.findOne({ where: { id } });
    return model ? toVerificationSlot(model) : null;
  }

  async remove(id: string, manager?: EntityManager): Promise<void> {
    const repo = manager
      ? manager.getRepository(VerificationSlotModel)
      : this.repo;
    await repo.delete(id);
  }

  async setStatus(
    id: string,
    status: VerificationSlotStatus,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(VerificationSlotModel)
      : this.repo;
    await repo.update(id, { status });
  }
}
