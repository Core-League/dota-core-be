import type {
  VerificationRequest,
  VerificationRequestView,
} from '../../types/entities/verification/request';
import type { VerificationSlot } from '../../types/entities/verification/slot';
import { toVerificationSlotView } from './verification-slot.mapper';
import { VerificationRequestModel } from '../models/verification-request.model';

/** TypeORM `VerificationRequestModel` (with `players`) → domain `VerificationRequest`. */
export function toVerificationRequest(
  model: VerificationRequestModel,
): VerificationRequest {
  return {
    id: model.id,
    teamId: model.teamId,
    slotId: model.slotId,
    type: model.type,
    status: model.status,
    createdByPlayerId: model.createdByPlayerId,
    createdAt: model.createdAt,
    players: (model.players ?? []).map((p) => ({
      id: p.id,
      playerId: p.playerId,
      resultMmr: p.resultMmr,
    })),
  };
}

/**
 * Domain request → wire view. `teamName` is resolved from the v1 `team` table
 * and `slot` is the request's (1:1) slot, both supplied by the caller.
 */
export function toVerificationRequestView(
  request: VerificationRequest,
  opts: { teamName: string | null; slot: VerificationSlot | null },
): VerificationRequestView {
  return {
    id: request.id,
    teamId: request.teamId,
    teamName: opts.teamName,
    type: request.type,
    status: request.status,
    createdByPlayerId: request.createdByPlayerId,
    createdAt: request.createdAt.toISOString(),
    slot: opts.slot ? toVerificationSlotView(opts.slot) : null,
    players: request.players,
  };
}
