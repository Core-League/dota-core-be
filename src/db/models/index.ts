import type { MixedList } from 'typeorm';
import { AccountModel } from './account.model';
import { AssetModel } from './asset.model';
import { CustomCategoryModel } from './custom-category.model';
import { ForecastConfigModel } from './forecast-config.model';
import { MmrUpdateRequestModel } from './mmr-update-request.model';
import { MmrUpdateRequestProofModel } from './mmr-update-request-proof.model';
import { OperationGroupModel } from './operation-group.model';
import { OperationModel } from './operation.model';
import { PlayerModel } from './player.model';
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
 * run via v2 migrations. The v1-owned `team` table is read via raw queries (see
 * `TeamRepository`) and is intentionally not modeled here. The v1-owned `player`
 * table is mapped **read-only** by {@link PlayerModel} (`synchronize: false`)
 * purely to back relations; v2 never alters it and still writes via raw SQL.
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
  PlayerModel,
  MmrUpdateRequestModel,
  MmrUpdateRequestProofModel,
  VerificationSlotModel,
  VerificationRequestModel,
  VerificationRequestPlayerModel,
  TagModel,
  PlayerTagModel,
];
