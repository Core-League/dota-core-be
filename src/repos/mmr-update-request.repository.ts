import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { toMmrUpdateRequest } from '../db/mappers/mmr-update-request.mapper';
import { MmrUpdateRequestModel } from '../db/models/mmr-update-request.model';
import { MmrUpdateRequestProofModel } from '../db/models/mmr-update-request-proof.model';
import type { MmrUpdateRequest } from '../types/entities/mmr/request';
import { MmrUpdateRequestStatus } from '../types/enums/mmr/MmrUpdateRequestStatus';

export interface UpsertMmrRequestInput {
  playerId: string;
  oldMmr: number;
  newMmr: number;
  /** Pre-created proof asset ids, in display order. */
  proofAssetIds: string[];
}

/** Relations every read needs to map a request to its domain shape. */
const REQUEST_RELATIONS = { player: true, proofs: { asset: true } } as const;

/** Persistence for v2-owned MMR-update requests (one row per player). */
@Injectable()
export class MmrUpdateRequestRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findById(id: string): Promise<MmrUpdateRequest | null> {
    const model = await this.dataSource
      .getRepository(MmrUpdateRequestModel)
      .findOne({ where: { id }, relations: REQUEST_RELATIONS });
    return model ? toMmrUpdateRequest(model) : null;
  }

  async findByPlayerId(playerId: string): Promise<MmrUpdateRequest | null> {
    const model = await this.dataSource
      .getRepository(MmrUpdateRequestModel)
      .findOne({ where: { playerId }, relations: REQUEST_RELATIONS });
    return model ? toMmrUpdateRequest(model) : null;
  }

  /** Every request, newest first; optionally filtered by status (admin list). */
  async findAll(status: MmrUpdateRequestStatus): Promise<MmrUpdateRequest[]> {
    const models = await this.dataSource
      .getRepository(MmrUpdateRequestModel)
      .find({
        where: status ? { status } : {},
        relations: REQUEST_RELATIONS,
        order: { createdAt: 'DESC' },
      });
    return models.map(toMmrUpdateRequest);
  }

  /**
   * Replace the player's single request: deletes any existing row (its proof
   * assets/files are removed by the caller first) and inserts a fresh `pending`
   * one, linking the pre-created proof assets in order.
   */
  async replaceForPlayer(
    input: UpsertMmrRequestInput,
  ): Promise<MmrUpdateRequest> {
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(MmrUpdateRequestModel);
      const proofRepo = m.getRepository(MmrUpdateRequestProofModel);
      await repo.delete({ playerId: input.playerId });
      const saved = await repo.save(
        repo.create({
          playerId: input.playerId,
          oldMmr: input.oldMmr,
          newMmr: input.newMmr,
          status: MmrUpdateRequestStatus.Pending,
        }),
      );
      if (input.proofAssetIds.length > 0) {
        await proofRepo.insert(
          input.proofAssetIds.map((assetId, ordinal) => ({
            requestId: saved.id,
            assetId,
            ordinal,
          })),
        );
      }
      const model = await repo.findOneOrFail({
        where: { id: saved.id },
        relations: REQUEST_RELATIONS,
      });
      return toMmrUpdateRequest(model);
    });
  }

  async setStatus(
    id: string,
    status: MmrUpdateRequestStatus,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = (manager ?? this.dataSource.manager).getRepository(
      MmrUpdateRequestModel,
    );
    await repo.update(id, { status });
  }

  /** Run a unit of work in a transaction (used by approve). */
  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }
}
