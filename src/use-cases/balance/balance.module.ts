import { Module } from '@nestjs/common';
import { ForecastModule } from '../forecast/forecast.module';
import { BalanceService } from './balance.service';

@Module({
  imports: [ForecastModule],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}
