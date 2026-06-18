import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { toMmrUpdateRequestView } from '../../db/mappers/mmr-update-request.mapper';
import { MmrUpdateRequestRepository } from '../../repos/mmr-update-request.repository';
import { PlayerRepository } from '../../repos/player.repository';
import { TeamRepository } from '../../repos/team.repository';
import type {
  MmrUpdateRequest,
  MmrUpdateRequestView,
} from '../../types/entities/mmr/request';
import { MmrUpdateRequestStatus } from '../../types/enums/mmr/MmrUpdateRequestStatus';
import { ImageStorageConnectorService } from '../../connectors/image-storage/image-storage-connector.service';
import type { Image } from '../../types/entities/image/image';
import type { Asset } from '../../types/entities/finance/asset';
import { AssetType } from '../../types/enums/finance/AssetType';
import { StorageType } from '../../types/enums/finance/StorageType';
import { AssetService } from '../asset/asset.service';

/** Static category under `uploads/`; matches the `/uploads/mmr-proofs` route. */
const PROOF_CATEGORY = 'mmr-proofs';

/** Proofs are downscaled so width × height never exceeds 0.9 megapixels. 720p */
const MAX_PROOF_PIXELS = 921_600;

/** A player must wait this long after their last request before submitting again. */
const SUBMIT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export interface SubmitMmrRequestInput {
  newMmr: number;
  proofs: Image[];
}

/**
 * Player-facing MMR-update flow: a verified player submits a desired new MMR
 * with proof screenshots; the request overwrites their previous one (deleting
 * its proofs). Admins read, approve (write the MMR) or reject.
 */
@Injectable()
export class MmrUpdateService {
  constructor(
    private readonly requestRepo: MmrUpdateRequestRepository,
    private readonly playerRepo: PlayerRepository,
    private readonly teamRepo: TeamRepository,
    private readonly imageStorage: ImageStorageConnectorService,
    private readonly assetService: AssetService,
  ) {}

  /** Verified player submits/overwrites their MMR-update request. */
  async submit(
    playerId: string,
    input: SubmitMmrRequestInput,
  ): Promise<MmrUpdateRequestView> {
    if (input.proofs.length === 0) {
      throw new BadRequestException('At least one proof image is required');
    }

    const [player] = await this.playerRepo.findByIds([playerId]);
    if (!player) {
      throw new NotFoundException('Player not found');
    }

    if (player.verifiedAt == null) {
      throw new ForbiddenException(
        'Лише верифіковані гравці можуть подавати заявку на оновлення MMR',
      );
    }

    // Drop the previous request's proof assets/files before storing the new ones.
    const existing = await this.requestRepo.findByPlayerId(playerId);
    if (existing) {
      const elapsed = Date.now() - existing.createdAt.getTime();
      if (elapsed < SUBMIT_COOLDOWN_MS) {
        throw new ForbiddenException(
          'Подати нову заявку на оновлення MMR можна не раніше ніж через 12 годин після попередньої',
        );
      }

      await this.deleteProofAssets(existing.proofs);
    }

    const proofPaths = await this.imageStorage.store(input.proofs, {
      category: PROOF_CATEGORY,
      maxPixels: MAX_PROOF_PIXELS,
    });
    const proofAssets = await this.assetService.createMany(
      proofPaths.map((path, i) => ({
        // Reuse the image's UUID as the asset id so it matches the file name.
        id: input.proofs[i].externalId,
        name: `MMR proof ${i + 1}`,
        type: AssetType.Proof,
        storageType: StorageType.Local,
        path,
      })),
    );
    const request = await this.requestRepo.replaceForPlayer({
      playerId,
      oldMmr: Math.round(player.rating),
      newMmr: input.newMmr,
      proofAssetIds: proofAssets.map((asset) => asset.id),
    });

    return this.toView(request);
  }

  /** The player's own current request (with proof URLs), or null. */
  async getMine(playerId: string): Promise<MmrUpdateRequestView | null> {
    const request = await this.requestRepo.findByPlayerId(playerId);
    return request ? this.toView(request) : null;
  }

  /** Admin list — every request (optionally by status), with proof image URLs. */
  async listForAdmin(
    status?: MmrUpdateRequestStatus,
  ): Promise<MmrUpdateRequestView[]> {
    const requests = await this.requestRepo.findAll(
      status || MmrUpdateRequestStatus.Pending,
    );
    return Promise.all(requests.map((request) => this.toView(request)));
  }

  /** Admin approves: write `newMmr` to the player's rating, mark approved. */
  async approve(id: string): Promise<MmrUpdateRequestView> {
    const request = await this.assertDecidable(id);
    await this.requestRepo.transaction(async (m) => {
      await this.playerRepo.applyResults(
        [{ playerId: request.playerId, mmr: request.newMmr }],
        false,
        m,
      );
      await this.requestRepo.setStatus(id, MmrUpdateRequestStatus.Approved, m);
    });
    return this.toView({ ...request, status: MmrUpdateRequestStatus.Approved });
  }

  /** Admin rejects: mark rejected and remove the proof assets/files. */
  async reject(id: string): Promise<MmrUpdateRequestView> {
    const request = await this.assertDecidable(id);
    await this.requestRepo.setStatus(id, MmrUpdateRequestStatus.Rejected);
    return this.toView({
      ...request,
      status: MmrUpdateRequestStatus.Rejected,
      proofs: [],
    });
  }

  /**
   * Remove proof assets: delete their files (by the asset's stored public path),
   * then their `asset` rows (which cascade-delete any `mmr_update_request_proof`
   * links). No-op when empty.
   */
  private async deleteProofAssets(proofs: Asset[]): Promise<void> {
    if (proofs.length === 0) return;
    await this.imageStorage.delete(proofs.map((asset) => asset.path));
    await this.assetService.deleteByIds(proofs.map((asset) => asset.id));
  }

  /** Load + guard that a request is still pending (not already decided). */
  private async assertDecidable(id: string): Promise<MmrUpdateRequest> {
    const request = await this.requestRepo.findById(id);
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== MmrUpdateRequestStatus.Pending) {
      throw new ConflictException(`Request is already ${request.status}`);
    }
    return request;
  }

  private async toView(
    request: MmrUpdateRequest,
  ): Promise<MmrUpdateRequestView> {
    const team = await this.teamRepo.findTeamByMainPlayer(request.playerId);
    return toMmrUpdateRequestView(request, {
      team,
      proofs: this.assetService.toViews(request.proofs),
    });
  }
}
