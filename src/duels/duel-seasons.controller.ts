import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
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
import { AdminGuard } from '../admin/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DuelLeaderboardDto } from './dto/duel.dto';
import {
  DuelSeasonDto,
  SetDuelSeasonPrizeIssuedDto,
  UpdateDuelSeasonPrizesDto,
} from './dto/duel-season.dto';
import { DuelSeasonsService } from './duel-seasons.service';

type AuthedRequest = Request & { user: { playerId: string } };

/**
 * Monthly seasons of the 1v1 ladder. A prefix of its own (not `/duels/…`) so
 * these routes can never be swallowed by `GET /duels/:id`.
 */
@ApiTags('duels')
@Controller('duel-seasons')
export class DuelSeasonsController {
  constructor(private readonly seasons: DuelSeasonsService) {}

  @Get()
  @ApiOperation({
    summary: 'Ladder seasons, newest first',
    description: 'Public. Ended seasons carry their winners per prize place.',
  })
  @ApiOkResponse({ type: DuelSeasonDto, isArray: true })
  list(): Promise<DuelSeasonDto[]> {
    return this.seasons.list();
  }

  @Get('current')
  @ApiOperation({
    summary: 'The active ladder season',
    description:
      'Public. `closing` is true between the end of the month and the rollover (ladder queue closed).',
  })
  @ApiOkResponse({ type: DuelSeasonDto })
  current(): Promise<DuelSeasonDto> {
    return this.seasons.current();
  }

  @Get(':id/leaderboard')
  @ApiOperation({
    summary: 'Leaderboard of a season',
    description:
      'Public. The live ladder for the active season, the frozen final table for an ended one.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelLeaderboardDto })
  leaderboard(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DuelLeaderboardDto> {
    return this.seasons.leaderboard(id);
  }

  @Patch(':id/prizes')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Set the prize places of the active season (admin)',
    description:
      'Replaces all places. VIP places are granted automatically at the end of the season; ' +
      'custom ones are handed out by admins. 409 once the season has ended.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelSeasonDto })
  updatePrizes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDuelSeasonPrizesDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelSeasonDto> {
    return this.seasons.updatePrizes(id, body.prizes, req.user.playerId);
  }

  @Patch(':id/prizes/:place')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark a won prize as handed out (admin)',
    description:
      'For custom prizes (and VIP whose automatic grant failed). 409 before the winners are fixed ' +
      'or when nobody held the place.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'place', type: Number })
  @ApiOkResponse({ type: DuelSeasonDto })
  setPrizeIssued(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('place', ParseIntPipe) place: number,
    @Body() body: SetDuelSeasonPrizeIssuedDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelSeasonDto> {
    return this.seasons.setPrizeIssued(
      id,
      place,
      body.issued,
      req.user.playerId,
    );
  }
}
