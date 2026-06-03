import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { StorageType } from '../../types/enums/finance/StorageType';

/**
 * A managed image asset (`asset`) — the pool of icons/logos a user can
 * attach to operations, groups, and categories via an `iconAssetId` FK. Only
 * `storageType` + `path` are persisted; the URL is resolved at read time.
 */
@Entity({ name: 'asset' })
export class AssetModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'enum', enum: StorageType, default: StorageType.Local })
  storageType: StorageType;

  /** Key / relative path within `storageType` (e.g. `icons/gift.svg`). */
  @Column({ type: 'varchar' })
  path: string;
}
