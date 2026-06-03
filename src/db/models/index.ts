import type { MixedList } from 'typeorm';
import { AccountModel } from './account.model';
import { AssetModel } from './asset.model';
import { CustomCategoryModel } from './custom-category.model';
import { ForecastConfigModel } from './forecast-config.model';
import { OperationGroupModel } from './operation-group.model';
import { OperationModel } from './operation.model';
import { SponsorModel } from './sponsor.model';
import { TransactionModel } from './transaction.model';

/**
 * Single source of truth for v2's Postgres persistence models, consumed by
 * `DbModule`. v2 owns the `finance_*` tables (synchronized in dev, migrated in
 * staging/prod). The v1-owned `team` table is read via a raw query in
 * `TeamRepository`, so it is intentionally not modeled here.
 */
export const entities: MixedList<string | (new () => unknown)> = [
  TransactionModel,
  OperationModel,
  OperationGroupModel,
  SponsorModel,
  CustomCategoryModel,
  AccountModel,
  ForecastConfigModel,
  AssetModel,
];
