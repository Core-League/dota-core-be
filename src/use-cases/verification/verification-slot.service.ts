import { BadRequestException, Injectable } from '@nestjs/common';
import { toVerificationSlotView } from '../../db/mappers/verification-slot.mapper';
import { SlotRepository } from '../../repos/verification-slot.repository';
import type { VerificationSlotView } from '../../types/entities/verification/slot';
import { VerificationSlotStatus } from '../../types/enums/verification/VerificationSlotStatus';
import { SLOT_MINUTES, utcDayRange } from './verification.constants';

export interface CreateSlotsInput {
  from: string; // ISO 8601 UTC date-time
  to: string; // ISO 8601 UTC date-time
}

/**
 * Admin-facing verification calendar: generate a day's `free` 30-min slots from
 * a working-hours range, list free slots, and remove a free slot. Booked-slot
 * removal (which cancels the linked request) lives in the request service.
 */
@Injectable()
export class VerificationSlotService {
  constructor(private readonly slotRepo: SlotRepository) {}

  /** Auto-generate back-to-back 30-min free slots, skipping ones already published. */
  async createSlots(input: CreateSlotsInput): Promise<VerificationSlotView[]> {
    const from = parseUtcDateTime(input.from);
    const to = parseUtcDateTime(input.to);
    const date = from.toISOString().slice(0, 10);
    if (to.toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('from and to must be on the same date');
    }
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('to must be after from');
    }

    const stepMs = SLOT_MINUTES * 60 * 1000;
    const { start: dayStart, end: dayEnd } = utcDayRange(date);
    const existing = await this.slotRepo.findInRange(dayStart, dayEnd);
    const taken = new Set(existing.map((s) => s.startsAt.getTime()));

    const toCreate: { startsAt: Date; endsAt: Date }[] = [];
    for (let t = from.getTime(); t + stepMs <= to.getTime(); t += stepMs) {
      if (taken.has(t)) continue;
      toCreate.push({ startsAt: new Date(t), endsAt: new Date(t + stepMs) });
    }

    const created = await this.slotRepo.createMany(toCreate);
    return created.map(toVerificationSlotView);
  }

  /** Free slots for a UTC day (defaults to today). */
  async listFree(date?: string): Promise<VerificationSlotView[]> {
    const { start, end } = utcDayRange(date);
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
