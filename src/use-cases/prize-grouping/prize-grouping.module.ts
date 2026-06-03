import { Module } from '@nestjs/common';
import { AssetModule } from '../asset/asset.module';
import { TeamModule } from '../team/team.module';
import { PrizeGroupingService } from './prize-grouping.service';

@Module({
  imports: [TeamModule, AssetModule],
  providers: [PrizeGroupingService],
  exports: [PrizeGroupingService],
})
export class PrizeGroupingModule {}
