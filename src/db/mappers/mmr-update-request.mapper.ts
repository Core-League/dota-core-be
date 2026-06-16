import { MmrUpdateRequestModel } from '../models/mmr-update-request.model';
import { toAsset } from './asset.mapper';
import type { AssetView } from '../../types/entities/finance/asset';
import type {
  MmrTeam,
  MmrUpdateRequest,
  MmrUpdateRequestView,
} from '../../types/entities/mmr/request';

/**
 * TypeORM `MmrUpdateRequestModel` (with `player` and `proofs.asset`) → domain
 * `MmrUpdateRequest`. Proof assets are ordered by their join-row `ordinal`.
 */
export function toMmrUpdateRequest(
  model: MmrUpdateRequestModel,
): MmrUpdateRequest {
  return {
    id: model.id,
    playerId: model.playerId,
    oldMmr: model.oldMmr,
    newMmr: model.newMmr,
    status: model.status,
    proofs: (model.proofs ?? [])
      .slice()
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((proof) => toAsset(proof.asset)),
    createdAt: model.createdAt,
    player: {
      id: model.player.id,
      steamId: model.player.steamId,
      avatarUrl: model.player.avatarUrl,
      discordName: model.player.discordName,
      discordUsername: model.player.discordUsername,
      rating: model.player.rating,
      positions: model.player.positions,
      verifiedAt: model.player.verifiedAt,
    },
  };
}

/**
 * Full view — `proofs` are the request's proof assets already resolved to views
 * (id + url) by the caller (see `AssetService.toViews`).
 */
export function toMmrUpdateRequestView(
  request: MmrUpdateRequest,
  opts: { team: MmrTeam | null; proofs: AssetView[] },
): MmrUpdateRequestView {
  return {
    id: request.id,
    playerId: request.playerId,
    oldMmr: request.oldMmr,
    newMmr: request.newMmr,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    player: {
      ...request.player,
      verifiedAt: request.player.verifiedAt
        ? request.player.verifiedAt.toISOString()
        : null,
    },
    team: opts.team,
    proofs: opts.proofs,
  };
}
