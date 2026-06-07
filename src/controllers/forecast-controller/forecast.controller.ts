import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../connectors/auth/guards/admin.guard';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import type {
  ForecastConfig,
  ForecastResult,
} from '../../types/entities/finance/forecast';
import { ForecastCalculatorService } from '../../use-cases/forecast/forecast-calculator.service';
import { ForecastConfigDto, ForecastViewDto } from './forecast.dto';

@ApiTags('forecast')
@Controller('forecast')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ForecastController {
  constructor(private readonly forecast: ForecastCalculatorService) {}

  @Get()
  @ApiOperation({ summary: 'Active forecast config + computed result' })
  @ApiOkResponse({ type: ForecastViewDto })
  getActive(): Promise<{
    config: ForecastConfig;
    result: ForecastResult;
  } | null> {
    return this.forecast.getActive();
  }

  @Put()
  @ApiOperation({ summary: 'Set the active forecast config' })
  @ApiOkResponse({ type: ForecastViewDto })
  setActive(
    @Body() body: ForecastConfigDto,
  ): Promise<{ config: ForecastConfig; result: ForecastResult }> {
    return this.forecast.setActive(body);
  }
}
