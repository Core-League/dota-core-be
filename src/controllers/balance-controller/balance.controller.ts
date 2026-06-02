import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../connectors/auth/guards/admin.guard';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import type { Balance } from '../../types/entities/finance/balance';
import { BalanceService } from '../../use-cases/balance/balance.service';

@ApiTags('balance')
@Controller('balance')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get()
  @ApiOperation({ summary: 'Account balance (optionally with forecast)' })
  @ApiQuery({ name: 'includeForecast', required: false, type: Boolean })
  getBalance(
    @Query('includeForecast') includeForecast?: string,
  ): Promise<Balance> {
    return this.balanceService.getBalance(includeForecast === 'true');
  }
}
