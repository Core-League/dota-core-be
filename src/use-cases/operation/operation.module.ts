import { Module } from '@nestjs/common';
import { AssetModule } from '../asset/asset.module';
import { ForecastModule } from '../forecast/forecast.module';
import { OperationService } from './operation.service';

@Module({
  imports: [ForecastModule, AssetModule],
  providers: [OperationService],
  exports: [OperationService],
})
export class OperationModule {}
