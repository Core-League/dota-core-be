import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OperationType } from '../../types/enums/finance/OperationType';
import { AssetModel } from './asset.model';
import { bigintTransformer } from './bigint.transformer';
import { CustomCategoryModel } from './custom-category.model';
import { OperationGroupModel } from './operation-group.model';

/**
 * Classified operation for display (`operation`). Derived from a
 * {@link TransactionModel} (or manual — `transactionId` null). `amount` is
 * signed kopecks; color is derived from its sign and never stored. `groupId`
 * links to an {@link OperationGroupModel} when the op is collapsed into a group.
 */
@Entity({ name: 'operation' })
export class OperationModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  transactionId: string | null;

  @Column({ type: 'enum', enum: OperationType })
  type: OperationType;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount: number;

  @Column({ type: 'timestamptz' })
  time: Date;

  @Column({ type: 'varchar' })
  title: string;

  /** FK to the icon asset (sponsor logo, team avatar, or user-chosen). */
  @Column({ type: 'uuid', nullable: true })
  iconAssetId: string | null;

  @ManyToOne(() => AssetModel, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'iconAssetId' })
  iconAsset: AssetModel | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  groupId: string | null;

  @ManyToOne(() => OperationGroupModel, (group) => group.operations, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'groupId' })
  group: OperationGroupModel | null;

  @Column({ type: 'varchar', nullable: true })
  comment: string | null;

  /** FK to the assigned category (single per operation), or null. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => CustomCategoryModel, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'categoryId' })
  category: CustomCategoryModel | null;

  /** True once a user assigned the category by hand; locks it against auto-match. */
  @Column({ type: 'boolean', default: false })
  categoryManual: boolean;

  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;
}
