import {
  Body,
  Controller,
  Get,
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
import { MediaOrAdminGuard } from '../admin/guards/media-or-admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { DuelLeaderboardDto } from './dto/duel.dto';
import {
  CreateDuelTournamentDto,
  DuelTournamentDto,
  JoinDuelTournamentDto,
  UpdateDuelTournamentDto,
} from './dto/duel-tournament.dto';
import { DuelTournamentsService } from './duel-tournaments.service';

type AuthedRequest = Request & { user: { playerId: string } };
type MaybeAuthedRequest = Request & { user: { playerId: string } | null };

/**
 * Password-protected 1v1 tournaments. A prefix of its own (not `/duels/…`)
 * so these routes can never be swallowed by `GET /duels/:id`.
 */
@ApiTags('duels')
@Controller('duel-tournaments')
export class DuelTournamentsController {
  constructor(private readonly tournaments: DuelTournamentsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Duel tournaments, active first',
    description:
      'Public. With a token, `joined` / `canManage` describe the viewer. Never carries the password.',
  })
  @ApiOkResponse({ type: DuelTournamentDto, isArray: true })
  list(@Req() req: MaybeAuthedRequest): Promise<DuelTournamentDto[]> {
    return this.tournaments.list(req.user?.playerId ?? null);
  }

  @Post()
  @UseGuards(JwtAuthGuard, MediaOrAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a password-protected tournament (media staff or admin)',
  })
  @ApiOkResponse({ type: DuelTournamentDto })
  create(
    @Body() body: CreateDuelTournamentDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelTournamentDto> {
    return this.tournaments.create(req.user.playerId, body);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'One duel tournament',
    description:
      'Public. `password` is filled only for the organiser and admins.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelTournamentDto })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: MaybeAuthedRequest,
  ): Promise<DuelTournamentDto> {
    return this.tournaments.get(id, req.user?.playerId ?? null);
  }

  @Get(':id/leaderboard')
  @ApiOperation({
    summary: 'Leaderboard of a duel tournament',
    description:
      'Public, also after the tournament ended. Every participant, best rating first.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelLeaderboardDto })
  leaderboard(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DuelLeaderboardDto> {
    return this.tournaments.leaderboard(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Rename a tournament or change its password',
    description: 'Organiser or admin, while the tournament is ACTIVE.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelTournamentDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDuelTournamentDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelTournamentDto> {
    return this.tournaments.update(id, req.user.playerId, body);
  }

  @Post(':id/end')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'End a tournament',
    description:
      'Organiser or admin. Closes its queue and cancels its duels that have not started (no rating change); ' +
      'games already launched finish and still count. The leaderboard stays public.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelTournamentDto })
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<DuelTournamentDto> {
    return this.tournaments.end(id, req.user.playerId);
  }

  @Post(':id/join')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Join a tournament with its password',
    description:
      '403 on a wrong password, 409 once ended, 429 after 10 wrong attempts in 10 minutes. ' +
      'Then queue with POST /duels/queue { tournamentId }.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelTournamentDto })
  join(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: JoinDuelTournamentDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelTournamentDto> {
    return this.tournaments.join(id, req.user.playerId, body.password);
  }
}
