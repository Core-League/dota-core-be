import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  FinishMatch3RunDto,
  Match3LeaderboardDto,
  Match3RunResultDto,
  Match3RunStartDto,
} from './dto/match3.dto';
import { Match3Service } from './match3.service';

type AuthedRequest = Request & { user: { playerId: string } };
type MaybeAuthedRequest = Request & { user?: { playerId: string } | null };

@ApiTags('match3')
@Controller('match3')
export class Match3Controller {
  constructor(private readonly match3: Match3Service) {}

  @Get('leaderboard')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Match-3 mini-game leaderboard',
    description:
      'Public. Top 10 by each player’s best run; with a token `me` is the viewer’s best and place.',
  })
  @ApiOkResponse({ type: Match3LeaderboardDto })
  getLeaderboard(
    @Req() req: MaybeAuthedRequest,
  ): Promise<Match3LeaderboardDto> {
    return this.match3.getLeaderboard(req.user?.playerId ?? null);
  }

  @Post('runs')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Start a match-3 run',
    description:
      'Issues the board seed. An unfinished previous run of the player is dropped.',
  })
  @ApiOkResponse({ type: Match3RunStartDto })
  start(@Req() req: AuthedRequest): Promise<Match3RunStartDto> {
    return this.match3.startRun(req.user.playerId);
  }

  @Post('runs/:id/finish')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Finish a match-3 run',
    description:
      'Replays the action log from the run seed and stores the server-computed score. ' +
      '400 when the log breaks the rules, 404 when the run is unknown, finished or expired.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: Match3RunResultDto })
  finish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FinishMatch3RunDto,
    @Req() req: AuthedRequest,
  ): Promise<Match3RunResultDto> {
    return this.match3.finishRun(req.user.playerId, id, body.actions);
  }
}
