import { Module } from '@nestjs/common';
import { ForecastCalculatorService } from './forecast-calculator.service';

/** Provides the forecast calculator (repos come from the global ReposModule). */
@Module({
  providers: [ForecastCalculatorService],
  exports: [ForecastCalculatorService],
})
export class ForecastModule {}
