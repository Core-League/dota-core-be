import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../connectors/auth/guards/admin.guard';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import { ConfigConnectorService } from '../../connectors/config/config-connector.service';
import { SyncService } from '../../use-cases/sync/sync.service';
import { SyncRequestDto } from './sync.dto';

/** Manual statement backfill / reconciliation over a date range. */
@ApiTags('bank')
@Controller('bank/sync')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly config: ConfigConnectorService,
  ) { }

  @Post()
  @ApiOperation({ summary: 'Backfill transactions for a period' })
  async sync(@Body() body: SyncRequestDto): Promise<{ synced: number }> {
    const accountId =
      body.accountId ?? this.config.getEnvConfig().MONOBANK_ACCOUNT_ID;
    if (!accountId) {
      throw new BadRequestException(
        'accountId is required (or set MONOBANK_ACCOUNT_ID)',
      );
    }
    const synced = await this.syncService.syncPeriod(
      accountId,
      new Date(body.from),
      body.to ? new Date(body.to) : undefined,
    );
    return { synced };
  }
}
