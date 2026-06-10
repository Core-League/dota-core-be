import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { VerificationRequestStatus } from '../../types/enums/verification/VerificationRequestStatus';
import { VerificationType } from '../../types/enums/verification/VerificationType';
import { VerificationRequestPlayerModel } from './verification-request-player.model';
import { VerificationSlotModel } from './verification-slot.model';

/**
 * A captain's verification booking against a slot (`verification_request`).
 * `teamId`/`createdByPlayerId` reference v1-owned `team`/`player` rows (no DB FK
 * across the ownership boundary). v2 owns this table.
 */
@Entity({ name: 'verification_request' })
export class VerificationRequestModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  teamId: string;

  @Column({ type: 'uuid', unique: true })
  slotId: string;

  @OneToOne(() => VerificationSlotModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slotId' })
  slot: VerificationSlotModel;

  @Column({ type: 'enum', enum: VerificationType })
  type: VerificationType;

  @Column({
    type: 'enum',
    enum: VerificationRequestStatus,
    default: VerificationRequestStatus.Pending,
  })
  status: VerificationRequestStatus;

  @Column({ type: 'uuid' })
  createdByPlayerId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => VerificationRequestPlayerModel, (p) => p.request, {
    cascade: true,
  })
  players: VerificationRequestPlayerModel[];
}
