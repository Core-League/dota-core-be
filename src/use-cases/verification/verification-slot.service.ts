import { BadRequestException, Injectable } from '@nestjs/common';
import { toVerificationSlotView } from '../../db/mappers/verification-slot.mapper';
import { SlotRepository } from '../../repos/verification-slot.repository';
import type { VerificationSlotView } from '../../types/entities/verification/slot';
import { VerificationSlotStatus } from '../../types/enums/verification/VerificationSlotStatus';
import { SLOT_MINUTES, utcDateRange } from './verification.constants';

export interface CreateSlotsInput {
  starts: string[]; // ISO 8601 UTC date-time slot start times
}

/**
 * Admin-facing verification calendar: publish `free` 30-min slots for explicit
 * start times, list free slots, and remove a free slot. Booked-slot removal
 * (which cancels the linked request) lives in the request service.
 */
@Injectable()
export class VerificationSlotService {
  constructor(private readonly slotRepo: SlotRepository) {}

  /** Publish a 30-min free slot for each given start time. */
  async createSlots(input: CreateSlotsInput): Promise<VerificationSlotView[]> {
    const stepMs = SLOT_MINUTES * 60 * 1000;
    const toCreate = input.starts.map((s) => {
      const startsAt = parseUtcDateTime(s);
      return { startsAt, endsAt: new Date(startsAt.getTime() + stepMs) };
    });

    const created = await this.slotRepo.createMany(toCreate);
    return created.map(toVerificationSlotView);
  }

  /** Free slots across the inclusive `from`..`to` UTC day range (defaults to today). */
  async listFree(from?: string, to?: string): Promise<VerificationSlotView[]> {
    const { start, end } = utcDateRange(from, to);
    const slots = await this.slotRepo.findInRange(start, end, [
      VerificationSlotStatus.Free,
    ]);
    return slots.map(toVerificationSlotView);
  }
}

function parseUtcDateTime(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid date-time: ${value}`);
  }
  return parsed;
}
