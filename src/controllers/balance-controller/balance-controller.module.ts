import { Module } from '@nestjs/common';
import { BalanceModule } from '../../use-cases/balance/balance.module';
import { BalanceController } from './balance.controller';

@Module({
  imports: [BalanceModule],
  controllers: [BalanceController],
})
export class BalanceControllerModule {}
