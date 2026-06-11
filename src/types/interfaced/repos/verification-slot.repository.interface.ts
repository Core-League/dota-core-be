import type { VerificationSlot } from '../../entities/verification/slot';

export interface ISlotRepository {
  createMany(
    slots: { startsAt: Date; endsAt: Date }[],
  ): Promise<VerificationSlot[]>;
  findInRange(
    from: Date,
    to: Date,
    statuses?: VerificationSlot['status'][],
  ): Promise<VerificationSlot[]>;
  findById(id: string): Promise<VerificationSlot | null>;
  remove(id: string): Promise<void>;
  setStatus(id: string, status: VerificationSlot['status']): Promise<void>;
}
