import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SponsorKind } from '../../types/enums/finance/SponsorKind';
import { AssetModel } from './asset.model';

/**
 * A betking / Duelo GG income source (`sponsor`). `matchers` are
 * substrings tested against a transaction's `description`/`counterIban` during
 * classification; `logoAssetId` points at the managed asset used as its logo.
 */
@Entity({ name: 'sponsor' })
export class SponsorModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'uuid', nullable: true })
  logoAssetId: string | null;

  @ManyToOne(() => AssetModel, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'logoAssetId' })
  logoAsset: AssetModel | null;

  @Column({ type: 'enum', enum: SponsorKind })
  kind: SponsorKind;

  @Column({ type: 'text', array: true, default: '{}' })
  matchers: string[];
}
