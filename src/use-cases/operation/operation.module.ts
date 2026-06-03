import { Module } from '@nestjs/common';
import { AssetModule } from '../asset/asset.module';
import { ForecastModule } from '../forecast/forecast.module';
import { PrizeGroupingModule } from '../prize-grouping/prize-grouping.module';
import { OperationService } from './operation.service';

@Module({
  imports: [PrizeGroupingModule, ForecastModule, AssetModule],
  providers: [OperationService],
  exports: [OperationService],
})
export class OperationModule {}
