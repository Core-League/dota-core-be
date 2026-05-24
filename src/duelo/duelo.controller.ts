import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { DueloService } from './duelo.service';

@ApiTags('duelo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('duelo')
export class DueloController {
  constructor(private readonly dueloService: DueloService) {}

  @Post('sync/:tournamentId')
  @ApiOperation({
    summary: 'Sync all tournament matches to Duelo.gg',
    description:
      'Sends all qualification and playoff matches (with a real dotaMatchId) from the given tournament to the Duelo.gg partner webhook. Returns counts of sent, errored, and skipped matches.',
  })
  @ApiParam({ name: 'tournamentId', type: String, format: 'uuid' })
  syncTournamentMatches(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
  ): Promise<{ sent: number; errors: number; skipped: number }> {
    return this.dueloService.syncTournamentMatches(tournamentId);
  }
}
