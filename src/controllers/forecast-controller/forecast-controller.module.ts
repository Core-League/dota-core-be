import { Module } from '@nestjs/common';
import { ForecastModule } from '../../use-cases/forecast/forecast.module';
import { ForecastController } from './forecast.controller';

@Module({
  imports: [ForecastModule],
  controllers: [ForecastController],
})
export class ForecastControllerModule {}
