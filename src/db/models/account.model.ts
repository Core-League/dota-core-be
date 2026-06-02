import { Column, Entity, PrimaryColumn } from 'typeorm';
import { bigintTransformer } from './bigint.transformer';

/**
 * Local mirror of a Bank account (`account`), refreshed from
 * `client-info`. PK is the Bank account id; `balance` is authoritative
 * kopecks.
 */
@Entity({ name: 'account' })
export class AccountModel {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'text', array: true, default: '{}' })
  maskedPan: string[];

  @Column({ type: 'bigint', transformer: bigintTransformer })
  balance: number;

  @Column({ type: 'int' })
  currencyCode: number;

  @Column({ type: 'varchar' })
  type: string;
}
