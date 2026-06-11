import type {
  VerificationRequest,
  VerificationRequestView,
  VerificationTeam,
  VerificationTeamView,
} from '../../types/entities/verification/request';
import type { VerificationSlot } from '../../types/entities/verification/slot';
import { toVerificationSlotView } from './verification-slot.mapper';
import { VerificationRequestModel } from '../models/verification-request.model';

/** Domain team → wire view (timestamps as ISO strings). */
export function toVerificationTeamView(
  team: VerificationTeam,
): VerificationTeamView {
  return {
    ...team,
    verifiedAt: team.verifiedAt ? team.verifiedAt.toISOString() : null,
    disbandedAt: team.disbandedAt ? team.disbandedAt.toISOString() : null,
  };
}

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
      resultMmr: p.resultMmr,
      player: {
        id: p.player.id,
        steamId: p.player.steamId,
        avatarUrl: p.player.avatarUrl,
        discordName: p.player.discordName,
        discordUsername: p.player.discordUsername,
        rating: p.player.rating,
        positions: p.player.positions,
        verifiedAt: p.player.verifiedAt,
      },
    })),
  };
}

/**
 * Domain request → wire view. `team` is the full v1 `team` row and `slot` is the
 * request's (1:1) slot, both supplied by the caller.
 */
export function toVerificationRequestView(
  request: VerificationRequest,
  opts: { team: VerificationTeam | null; slot: VerificationSlot | null },
): VerificationRequestView {
  return {
    id: request.id,
    teamId: request.teamId,
    team: opts.team ? toVerificationTeamView(opts.team) : null,
    type: request.type,
    status: request.status,
    createdByPlayerId: request.createdByPlayerId,
    createdAt: request.createdAt.toISOString(),
    slot: opts.slot ? toVerificationSlotView(opts.slot) : null,
    players: request.players.map((p) => ({
      id: p.id,
      resultMmr: p.resultMmr,
      player: {
        ...p.player,
        verifiedAt: p.player.verifiedAt
          ? p.player.verifiedAt.toISOString()
          : null,
      },
    })),
  };
}
