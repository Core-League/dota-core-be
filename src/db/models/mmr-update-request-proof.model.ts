import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { AssetModel } from './asset.model';
import { MmrUpdateRequestModel } from './mmr-update-request.model';

/**
 * Join row linking an `mmr_update_request` to one proof {@link AssetModel}, in
 * `ordinal` order (a request has up to a few proofs). Composite PK
 * `(requestId, assetId)`. Both FKs cascade-delete: dropping the request or the
 * asset removes the link. v2 owns this table.
 */
@Entity({ name: 'mmr_update_request_proof' })
export class MmrUpdateRequestProofModel {
  @PrimaryColumn({ type: 'uuid' })
  requestId: string;

  @PrimaryColumn({ type: 'uuid' })
  assetId: string;

  @Column({ type: 'int' })
  ordinal: number;

  @ManyToOne(() => MmrUpdateRequestModel, (request) => request.proofs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'requestId',
    foreignKeyConstraintName: 'FK_mmr_update_request_proof_request',
  })
  request: MmrUpdateRequestModel;

  @ManyToOne(() => AssetModel, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'assetId',
    foreignKeyConstraintName: 'FK_mmr_update_request_proof_asset',
  })
  asset: AssetModel;
}
