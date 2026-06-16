import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { StorageType } from '../../types/enums/finance/StorageType';
import { AssetType } from '../../types/enums/finance/AssetType';

/**
 * A managed image asset (`asset`) — the pool of icons/logos a user can
 * attach to operations, groups, and categories via an `iconAssetId` FK, plus
 * MMR proof screenshots. Only `storageType` + `path` are persisted; the URL is
 * resolved at read time. `type` tags what the asset depicts (defaults UNKNOWN).
 */
@Entity({ name: 'asset' })
export class AssetModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'enum', enum: AssetType, default: AssetType.Unknown })
  type: AssetType;

  @Column({ type: 'enum', enum: StorageType, default: StorageType.Local })
  storageType: StorageType;

  /** Key / relative path within `storageType` (e.g. `icons/gift.svg`). */
  @Column({ type: 'varchar' })
  path: string;
}
