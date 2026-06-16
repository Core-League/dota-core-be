import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MmrUpdateRequestStatus } from '../../types/enums/mmr/MmrUpdateRequestStatus';
import { MmrUpdateRequestProofModel } from './mmr-update-request-proof.model';
import { PlayerModel } from './player.model';

/**
 * A verified player's request to change their MMR (`mmr_update_request`).
 * `playerId` references a v1-owned `player` row (exposed via the `player`
 * relation, no schema ownership) and is **unique** — there is at most one
 * request per player, overwritten on each new submission. Proof screenshots are
 * stored as `asset` rows linked via the `proofs` join relation. v2 owns this
 * table.
 */
@Entity({ name: 'mmr_update_request' })
export class MmrUpdateRequestModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  playerId: string;

  @ManyToOne(() => PlayerModel)
  @JoinColumn({
    name: 'playerId',
    foreignKeyConstraintName: 'FK_mmr_update_request_player',
  })
  player: PlayerModel;

  @Column({ type: 'int' })
  oldMmr: number;

  @Column({ type: 'int' })
  newMmr: number;

  @Column({
    type: 'enum',
    enum: MmrUpdateRequestStatus,
    default: MmrUpdateRequestStatus.Pending,
  })
  status: MmrUpdateRequestStatus;

  @OneToMany(() => MmrUpdateRequestProofModel, (proof) => proof.request, {
    cascade: true,
  })
  proofs: MmrUpdateRequestProofModel[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
