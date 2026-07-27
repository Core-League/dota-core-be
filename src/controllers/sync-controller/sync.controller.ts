import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../connectors/auth/guards/admin.guard';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import { ConfigConnectorService } from '../../connectors/config/config-connector.service';
import { SyncService } from '../../use-cases/sync/sync.service';
import { ReclassifyResultDto, SyncRequestDto, SyncResultDto } from './sync.dto';

/** Manual statement backfill / reconciliation over a date range. */
@ApiTags('bank')
@Controller('bank/sync')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly config: ConfigConnectorService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Backfill transactions for a period',
    description:
      'Reconciles entry-fee payments for any account/jar. Storing and classifying ' +
      'the statement is limited to `MONOBANK_ACCOUNT_ID(S)`, so backfilling a ' +
      'tournament jar recovers its payments without importing its traffic into ' +
      'the finance views — expect `synced: 0` there and read `reconciled`.',
  })
  @ApiCreatedResponse({ type: SyncResultDto })
  async sync(
    @Body() body: SyncRequestDto,
  ): Promise<{ synced: number; reconciled: number }> {
    const accountId =
      body.accountId ?? this.config.getEnvConfig().MONOBANK_ACCOUNT_ID;
    if (!accountId) {
      throw new BadRequestException(
        'accountId is required (or set MONOBANK_ACCOUNT_ID)',
      );
    }
    return this.syncService.syncPeriod(
      accountId,
      new Date(body.from),
      body.to ? new Date(body.to) : undefined,
    );
  }

  @Post('reclassify')
  @ApiOperation({
    summary: 'Re-run classification over all stored transactions',
  })
  @ApiCreatedResponse({ type: ReclassifyResultDto })
  async reclassify(): Promise<{ reclassified: number }> {
    const reclassified = await this.syncService.reclassifyAll();
    return { reclassified };
  }
}
