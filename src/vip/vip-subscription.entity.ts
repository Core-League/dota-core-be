import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';
import { VipProvider } from './vip.constants';

/**
 * One row per player who ever paid for VIP: the saved card and the
 * auto-renewal schedule. VIP itself lives on `player.vipUntil` (shared with
 * admin grants); this row only decides whether and when to charge again.
 *
 * Monobank's recommended rail for recurring payments is tokenization: the
 * first invoice carries `saveCardData`, and the merchant then charges the
 * `cardToken` through `POST /api/merchant/wallet/payment` on its own schedule.
 */
@Entity('vip_subscription')
@Unique('UQ_vip_subscription_player', ['playerId'])
export class VipSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  playerId: string;

  @OneToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  /** Merchant-side wallet id sent as `saveCardData.walletId` (the player id). */
  @Column({ type: 'varchar', length: 64 })
  walletId: string;

  /** Tokenized card; null until the first payment settles or after the card is forgotten. */
  @Column({ type: 'varchar', nullable: true })
  cardToken: string | null;

  /** E.g. `537541******1234`, for the "card on file" line in the UI. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  maskedPan: string | null;

  @Column({ type: 'boolean', default: false })
  autoRenew: boolean;

  /** When the next renewal charge may start; null while auto-renewal is off. */
  @Column({ type: 'timestamptz', nullable: true })
  nextChargeAt: Date | null;

  /** Consecutive failed renewals; reset by any successful payment. */
  @Column({ type: 'int', default: 0 })
  failedAttempts: number;

  /** Set while a renewal charge is in flight — the scheduler's claim marker. */
  @Column({ type: 'timestamptz', nullable: true })
  renewalClaimedAt: Date | null;

  /**
   * Public URL of THIS api's acquiring webhook, captured from the subscribe
   * request: the scheduler has no request to derive it from.
   */
  @Column({ type: 'varchar', nullable: true })
  webHookUrl: string | null;

  /** Who renews it: Monobank card token, or WayForPay's own monthly charge. */
  @Column({ type: 'varchar', length: 16, default: VipProvider.MONO })
  provider: VipProvider;

  /**
   * WayForPay: order reference of the paid first month — the regular payment's
   * name in regularApi (STATUS / SUSPEND / RESUME / REMOVE).
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  regularRef: string | null;

  /** WayForPay: when the newest monthly charge that extended VIP was paid. */
  @Column({ type: 'timestamptz', nullable: true })
  lastChargeAt: Date | null;

  /** Loyalty discount on every future month, percent (players who had paid through Monobank). */
  @Column({ type: 'int', default: 0 })
  discountPercent: number;

  /** When the switch to WayForPay cancelled this Monobank subscription's auto-renewal. */
  @Column({ type: 'timestamptz', nullable: true })
  paymentSwitchedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
