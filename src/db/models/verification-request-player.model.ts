import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlayerModel } from './player.model';
import { VerificationRequestModel } from './verification-request.model';

/**
 * A player included in a verification request (`verification_request_player`).
 * `playerId` references a v1-owned `player` row, exposed as the `player`
 * relation. `resultMmr` is filled when the admin completes the request.
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

  @ManyToOne(() => PlayerModel)
  @JoinColumn({
    name: 'playerId',
    foreignKeyConstraintName: 'FK_verification_request_player_player',
  })
  player: PlayerModel;

  @Column({ type: 'int', nullable: true })
  resultMmr: number | null;
}
