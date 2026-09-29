import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DuelDto,
  DuelLeaderboardDto,
  DuelPlayerProfileDto,
  DuelStatusDto,
} from './dto/duel.dto';
import { DuelsService } from './duels.service';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('duels')
@Controller('duels')
export class DuelsController {
  constructor(private readonly duels: DuelsService) {}

  // ── queue (JWT) ──────────────────────────────────────────────────────────

  @Post('queue')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Join the 1v1 queue',
    description:
      'Requires a linked Steam account. 409 when already in a duel, 429 during the no-show cooldown. ' +
      'Joining while already queued simply returns the current status.',
  })
  @ApiOkResponse({ type: DuelStatusDto })
  joinQueue(@Req() req: AuthedRequest): Promise<DuelStatusDto> {
    return this.duels.joinQueue(req.user.playerId);
  }

  @Delete('queue')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Leave the 1v1 queue' })
  @ApiOkResponse({ type: DuelStatusDto })
  leaveQueue(@Req() req: AuthedRequest): Promise<DuelStatusDto> {
    return this.duels.leaveQueue(req.user.playerId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'My 1v1 status',
    description:
      'Rating, queue state, active duel and the last finished duel. Poll every ~3 s while queued or in a duel: ' +
      'the call doubles as the queue heartbeat, a client that stops polling is dropped from the queue after 20 s.',
  })
  @ApiOkResponse({ type: DuelStatusDto })
  getMe(@Req() req: AuthedRequest): Promise<DuelStatusDto> {
    return this.duels.getStatus(req.user.playerId);
  }

  // ── public ───────────────────────────────────────────────────────────────

  @Get('leaderboard')
  @ApiOperation({
    summary: '1v1 leaderboard',
    description:
      'Every player with at least one played duel, best rating first.',
  })
  @ApiOkResponse({ type: DuelLeaderboardDto })
  getLeaderboard(): Promise<DuelLeaderboardDto> {
    return this.duels.getLeaderboard();
  }

  @Get('players/:id')
  @ApiOperation({ summary: '1v1 line of a player: rating + last 10 duels' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelPlayerProfileDto })
  getPlayerProfile(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DuelPlayerProfileDto> {
    return this.duels.getPlayerProfile(id, null);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One duel (lobby password hidden for non-participants)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelDto })
  getDuel(@Param('id', ParseUUIDPipe) id: string): Promise<DuelDto> {
    return this.duels.getDuel(id, null);
  }
}
