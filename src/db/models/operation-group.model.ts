import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OperationGroupKind } from '../../types/enums/finance/OperationGroupKind';
import { AssetModel } from './asset.model';
import { bigintTransformer } from './bigint.transformer';
import { OperationModel } from './operation.model';

/**
 * A collapsed set of operations shown as one feed row (`operation_group`).
 * Single mechanism for automatic `PRIZE` groups (`groupKey` = normalized comment)
 * and manual `CUSTOM` groups. `aggregatedAmount` is the signed kopeck sum of its
 * members.
 */
@Entity({ name: 'operation_group' })
export class OperationGroupModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: OperationGroupKind })
  kind: OperationGroupKind;

  @Column({ type: 'varchar' })
  title: string;

  /** FK to the icon asset (team avatar for PRIZE, user-chosen for CUSTOM). */
  @Column({ type: 'uuid', nullable: true })
  iconAssetId: string | null;

  @ManyToOne(() => AssetModel, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'iconAssetId' })
  iconAsset: AssetModel | null;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  aggregatedAmount: number;

  @Index()
  @Column({ type: 'varchar' })
  groupKey: string;

  @OneToMany(() => OperationModel, (operation) => operation.group)
  operations: OperationModel[];
}
