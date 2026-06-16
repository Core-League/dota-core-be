import { Global, Module, type Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModel } from '../db/models/account.model';
import { AssetModel } from '../db/models/asset.model';
import { CustomCategoryModel } from '../db/models/custom-category.model';
import { ForecastConfigModel } from '../db/models/forecast-config.model';
import { OperationGroupModel } from '../db/models/operation-group.model';
import { OperationModel } from '../db/models/operation.model';
import { SponsorModel } from '../db/models/sponsor.model';
import { TransactionModel } from '../db/models/transaction.model';
import { AccountRepository } from './account.repository';
import { AssetRepository } from './asset.repository';
import { CustomCategoryRepository } from './custom-category.repository';
import { ForecastConfigRepository } from './forecast-config.repository';
import { OperationGroupRepository } from './operation-group.repository';
import { OperationRepository } from './operation.repository';
import { SponsorRepository } from './sponsor.repository';
import { TeamRepository } from './team.repository';
import { TransactionRepository } from './transaction.repository';
import { VerificationSlotModel } from '../db/models/verification-slot.model';
import { VerificationRequestModel } from '../db/models/verification-request.model';
import { VerificationRequestPlayerModel } from '../db/models/verification-request-player.model';
import { SlotRepository } from './verification-slot.repository';
import { RequestRepository } from './verification-request.repository';
import { PlayerRepository } from './player.repository';
import { TagModel } from '../db/models/tag.model';
import { PlayerTagModel } from '../db/models/player-tag.model';
import { TagRepository } from './tag.repository';
import { MmrUpdateRequestModel } from '../db/models/mmr-update-request.model';
import { MmrUpdateRequestRepository } from './mmr-update-request.repository';

/**
 * Global registry of v2 repositories. `forFeature` binds the TypeORM models so
 * each repository can inject its `Repository<XModel>`; the wrapper repos are
 * exported so any use-case can depend on them.
 */
const repos: Provider[] = [
  TransactionRepository,
  OperationRepository,
  OperationGroupRepository,
  SponsorRepository,
  CustomCategoryRepository,
  AccountRepository,
  ForecastConfigRepository,
  TeamRepository,
  AssetRepository,
  SlotRepository,
  RequestRepository,
  PlayerRepository,
  TagRepository,
  MmrUpdateRequestRepository,
];

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
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
      MmrUpdateRequestModel,
    ]),
  ],
  providers: repos,
  exports: repos,
})
export class ReposModule {}
