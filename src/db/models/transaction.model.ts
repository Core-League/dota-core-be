import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { bigintTransformer } from './bigint.transformer';

/**
 * Persisted raw bank transaction (`transaction`). PK is the Bank
 * transaction id, so a webhook push and a statement read of the same item
 * de-dupe to one row. Money columns are `bigint` kopecks. Immutable.
 */
@Entity({ name: 'transaction' })
export class TransactionModel {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  accountId: string;

  @Column({ type: 'timestamptz' })
  time: Date;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount: number;

  @Column({ type: 'varchar' })
  description: string;

  @Column({ type: 'varchar', nullable: true })
  comment: string | null;

  @Column({ type: 'int' })
  mcc: number;

  @Column({ type: 'varchar', nullable: true })
  counterIban: string | null;

  @Column({ type: 'varchar', nullable: true })
  counterEdrpou: string | null;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  balance: number;

  @Column({ type: 'boolean' })
  hold: boolean;

  @Column({ type: 'int' })
  currencyCode: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
