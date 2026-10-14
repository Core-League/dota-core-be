import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** What a consent was given for. */
export enum PaymentConsentProduct {
  ENTRY_FEE = 'ENTRY_FEE',
  /** Voluntary support of the league (the `tournament_donation` rail). */
  SUPPORT = 'SUPPORT',
  VIP = 'VIP',
}

/** Who minted the payment page the consent belongs to. */
export type TPaymentConsentProvider = 'wayforpay' | 'monobank';

/**
 * Append-only log of checkout consent: one row per newly minted payment page,
 * written in the same transaction as the payment row that records the page.
 * Proves which version of the offer / terms / refund policy the payer agreed
 * to before paying. Never updated or deleted (a trigger refuses both, see the
 * migration); no foreign keys, so the proof outlives a deleted account or
 * tournament. No IP address is stored.
 */
@Entity('payment_consent')
@Index('IDX_payment_consent_reference', ['reference'])
@Index('IDX_payment_consent_player', ['playerId'])
export class PaymentConsent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** The payer; null for a guest support payment. */
  @Column({ name: 'player_id', type: 'uuid', nullable: true })
  playerId: string | null;

  @Column({ name: 'legal_version', type: 'varchar', length: 32 })
  legalVersion: string;

  @Column({ type: 'varchar', length: 16 })
  product: PaymentConsentProduct;

  /** The payment reference shown to the payer (`CORE-…`, `DON-…`, `VIP-…`). */
  @Column({ type: 'varchar', length: 64 })
  reference: string;

  @Column({ name: 'amount_kopecks', type: 'int' })
  amountKopecks: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'varchar', length: 16 })
  provider: TPaymentConsentProvider;
}
