import type {
  VerificationSlot,
  VerificationSlotView,
} from '../../types/entities/verification/slot';
import { VerificationSlotModel } from '../models/verification-slot.model';

/** TypeORM `VerificationSlotModel` → domain `VerificationSlot`. */
export function toVerificationSlot(
  model: VerificationSlotModel,
): VerificationSlot {
  return {
    id: model.id,
    startsAt: model.startsAt,
    endsAt: model.endsAt,
    status: model.status,
  };
}

export function toVerificationSlotView(
  slot: VerificationSlot,
): VerificationSlotView {
  return {
    id: slot.id,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    status: slot.status,
  };
}
