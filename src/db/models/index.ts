import type { MixedList } from 'typeorm';
import { AccountModel } from './account.model';
import { AssetModel } from './asset.model';
import { CustomCategoryModel } from './custom-category.model';
import { ForecastConfigModel } from './forecast-config.model';
import { OperationGroupModel } from './operation-group.model';
import { OperationModel } from './operation.model';
import { SponsorModel } from './sponsor.model';
import { PlayerTagModel } from './player-tag.model';
import { TagModel } from './tag.model';
import { TransactionModel } from './transaction.model';
import { VerificationRequestPlayerModel } from './verification-request-player.model';
import { VerificationRequestModel } from './verification-request.model';
import { VerificationSlotModel } from './verification-slot.model';

/**
 * Single source of truth for v2's Postgres persistence models, consumed by
 * `DbModule`. v2 owns the finance tables, the verification calendar tables
 * (`verification_*`), and the moderation tag tables (`tag`/`player_tag`), all
 * run via v2 migrations. The v1-owned `team`/`player`
 * tables are read via raw queries (see `TeamRepository`/`PlayerRepository`), so
 * they are intentionally not modeled here.
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
  VerificationSlotModel,
  VerificationRequestModel,
  VerificationRequestPlayerModel,
  TagModel,
  PlayerTagModel,
];
