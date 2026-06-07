import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CategorySign } from '../../types/enums/finance/CategorySign';
import { AssetModel } from './asset.model';

/** A reusable template for custom operations (`custom_category`): a relabel + icon asset. */
@Entity({ name: 'custom_category' })
export class CustomCategoryModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  label: string;

  @Column({ type: 'uuid', nullable: true })
  iconAssetId: string | null;

  @ManyToOne(() => AssetModel, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'iconAssetId' })
  iconAsset: AssetModel | null;

  @Column({
    type: 'enum',
    enum: CategorySign,
    default: CategorySign.Expense,
  })
  sign: CategorySign;

  /** Substrings matched against an operation's comment/description to auto-assign this category. */
  @Column({ type: 'text', array: true, default: [] })
  matchers: string[];
}
