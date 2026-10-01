import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { VipPaymentKind, VipPaymentStatus } from './vip.constants';

/**
 * One Monobank invoice for VIP — the first payment or a renewal. Callbacks are
 * attributed by `invoiceId`, then by `reference` (`VIP-…`), and settle a row
 * once: `PAID` is terminal, so a replayed or reordered callback can never
 * extend VIP twice.
 */
@Entity('vip_payment')
@Index('IDX_vip_payment_player', ['playerId'])
@Unique('UQ_vip_payment_reference', ['reference'])
@Unique('UQ_vip_payment_invoice', ['invoiceId'])
export class VipPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  playerId: string;

  @Column({ type: 'varchar', length: 32 })
  reference: string;

  @Column({ type: 'varchar', nullable: true })
  invoiceId: string | null;

  @Column({ type: 'varchar', length: 16 })
  kind: VipPaymentKind;

  @Column({ type: 'varchar', length: 16, default: VipPaymentStatus.PENDING })
  status: VipPaymentStatus;

  /** Kopecks. */
  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'varchar', nullable: true })
  pageUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  failureReason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
