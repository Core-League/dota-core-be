import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { AdminGuard } from '../admin/guards/admin.guard';
import { MediaOrAdminGuard } from '../admin/guards/media-or-admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  CreateDuelBracketDto,
  DuelBracketDto,
  DuelBracketMatchDto,
  DuelBracketSummaryDto,
  JoinDuelBracketDto,
  SetDuelBracketWinnerDto,
  StartDuelBracketDto,
  UpdateDuelBracketDto,
} from './dto/duel-bracket.dto';
import { DuelBracketsService } from './duel-brackets.service';

type AuthedRequest = Request & { user: { playerId: string } };
type MaybeAuthedRequest = Request & { user: { playerId: string } | null };

/**
 * Single-elimination 1v1 media tournaments («Медіа-турніри»). Streamers
 * (media staff) and admins run them; every match is a bot-hosted duel of
 * kind `bracket`. Prize images are uploaded through
 * `POST /duel-tournaments/prize-image`.
 */
@ApiTags('duels')
@Controller('duel-brackets')
export class DuelBracketsController {
  constructor(private readonly brackets: DuelBracketsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Bracket tournaments: live, then open, then finished',
    description:
      'Public. With a token, `joined` / `canManage` describe the viewer.',
  })
  @ApiOkResponse({ type: DuelBracketSummaryDto, isArray: true })
  list(@Req() req: MaybeAuthedRequest): Promise<DuelBracketSummaryDto[]> {
    return this.brackets.list(req.user?.playerId ?? null);
  }

  @Post()
  @UseGuards(JwtAuthGuard, MediaOrAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a bracket tournament (streamer or admin)',
    description: '403 when a non-admin puts VIP on a prize place.',
  })
  @ApiOkResponse({ type: DuelBracketDto })
  create(
    @Body() body: CreateDuelBracketDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelBracketDto> {
    return this.brackets.create(req.user.playerId, body);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'One bracket tournament with participants and every match',
    description:
      'Public. `password` and the lobby passwords of running matches are filled for the organiser and admins.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelBracketDto })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: MaybeAuthedRequest,
  ): Promise<DuelBracketDto> {
    return this.brackets.get(id, req.user?.playerId ?? null);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Edit a bracket tournament (organiser or admin)',
    description:
      'Password and size only during registration (409 after). VIP prize places — admins only (403).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelBracketDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDuelBracketDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelBracketDto> {
    return this.brackets.update(id, req.user.playerId, body);
  }

  @Post(':id/start')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Close registration and generate the bracket',
    description:
      'Organiser or admin; at least 2 players. Byes go to the top seeds; ' +
      'a third-place match is added when there are semi-finals. Ready matches get their duels at once.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelBracketDto })
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StartDuelBracketDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelBracketDto> {
    return this.brackets.start(id, req.user.playerId, body.seeding);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Call the tournament off (organiser or admin)',
    description:
      'Duels that have not started are cancelled; running games finish without counting. Irreversible.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelBracketDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<DuelBracketDto> {
    return this.brackets.cancel(id, req.user.playerId);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a bracket tournament (admin)',
    description:
      'Unstarted duels are cancelled, then the tournament goes with its bracket. Past duels stay in the history.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    await this.brackets.remove(id, req.user.playerId);
  }

  @Post(':id/join')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register for a bracket tournament',
    description:
      'Needs a linked Steam account (409). 403 on a wrong password, 409 when full or started, ' +
      '429 after 10 wrong passwords in 10 minutes.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelBracketDto })
  join(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: JoinDuelBracketDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelBracketDto> {
    return this.brackets.join(id, req.user.playerId, body.password ?? null);
  }

  @Post(':id/leave')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Withdraw before the launch' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelBracketDto })
  leave(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<DuelBracketDto> {
    return this.brackets.leave(id, req.user.playerId);
  }

  @Delete(':id/participants/:playerId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Remove a registered player (organiser or admin, before the launch)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'playerId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelBracketDto })
  removeParticipant(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('playerId', ParseUUIDPipe) playerId: string,
    @Req() req: AuthedRequest,
  ): Promise<DuelBracketDto> {
    return this.brackets.removeParticipant(id, req.user.playerId, playerId);
  }

  @Post(':id/matches/:matchId/winner')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Decide a match by hand (organiser or admin)',
    description:
      'Any undecided match with both players; its unstarted duel is cancelled. 409 while its game is running.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'matchId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelBracketDto })
  setWinner(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() body: SetDuelBracketWinnerDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelBracketDto> {
    return this.brackets.setWinner(
      id,
      matchId,
      req.user.playerId,
      body.winnerId,
    );
  }

  @Post(':id/matches/:matchId/replay')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Replay a match that waits for a decision (organiser or admin)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'matchId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelBracketDto })
  replay(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Req() req: AuthedRequest,
  ): Promise<DuelBracketDto> {
    return this.brackets.replay(id, matchId, req.user.playerId);
  }

  @Post(':id/matches/:matchId/spectate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Watch a match from its lobby (organiser or admin)',
    description:
      'The host bot invites the viewer into the lobby and lets them stay without a game slot. ' +
      'Until the game launches; needs a linked Steam account.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'matchId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelBracketMatchDto })
  spectate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Req() req: AuthedRequest,
  ): Promise<DuelBracketMatchDto> {
    return this.brackets.spectate(id, matchId, req.user.playerId);
  }
}
