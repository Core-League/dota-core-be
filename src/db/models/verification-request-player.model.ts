import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { VerificationRequestModel } from './verification-request.model';

/**
 * A player included in a verification request (`verification_request_player`).
 * `playerId` references a v1-owned `player` row. `resultMmr` is filled when the
 * admin completes the request.
 */
@Entity({ name: 'verification_request_player' })
export class VerificationRequestPlayerModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  requestId: string;

  @ManyToOne(() => VerificationRequestModel, (r) => r.players, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'requestId' })
  request: VerificationRequestModel;

  @Column({ type: 'uuid' })
  playerId: string;

  @Column({ type: 'int', nullable: true })
  resultMmr: number | null;
}
