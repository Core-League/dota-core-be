import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import {
  AdminListDuelsQueryDto,
  AdminResolveDuelDto,
  AdminSetDuelRatingDto,
  CreateHostBotDto,
  HostBotDto,
  UpdateHostBotDto,
} from './dto/duel-admin.dto';
import { DuelDto, DuelRatingDto } from './dto/duel.dto';
import { DuelsService } from './duels.service';
import { HostBotsService } from './host-bots.service';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/duels')
export class DuelsAdminController {
  constructor(
    private readonly duels: DuelsService,
    private readonly hostBots: HostBotsService,
  ) {}

  // ── bots (declared before ':id' routes) ──────────────────────────────────

  @Get('bots')
  @ApiOperation({
    summary: 'Host bot pool with live status from the bot-worker',
  })
  @ApiOkResponse({ type: HostBotDto, isArray: true })
  listBots(): Promise<HostBotDto[]> {
    return this.hostBots.list();
  }

  @Post('bots')
  @ApiOperation({
    summary: 'Add a Steam account to the pool',
    description:
      'Password is stored encrypted with HOSTBOT_SECRET_KEY. Steam Guard must be disabled on the account; ' +
      'the account must have opened Dota 2 once. The worker logs it in within ~30 s.',
  })
  @ApiOkResponse({ type: HostBotDto })
  createBot(@Body() body: CreateHostBotDto): Promise<HostBotDto> {
    return this.hostBots.create(body);
  }

  @Patch('bots/:id')
  @ApiOperation({ summary: 'Enable / disable a bot or rotate its password' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: HostBotDto })
  updateBot(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateHostBotDto,
  ): Promise<HostBotDto> {
    return this.hostBots.update(id, body);
  }

  @Delete('bots/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a bot (refused while it hosts a duel)' })
  @ApiParam({ name: 'id', type: Number })
  removeBot(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.hostBots.remove(id);
  }

  // ── ratings ──────────────────────────────────────────────────────────────

  @Patch('players/:id/rating')
  @ApiOperation({ summary: 'Override a player’s 1v1 rating' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelRatingDto })
  setRating(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminSetDuelRatingDto,
  ): Promise<DuelRatingDto> {
    return this.duels.adminSetRating(id, body.rating);
  }

  // ── duels ────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List duels, newest first (optional state filter)' })
  @ApiOkResponse({ type: DuelDto, isArray: true })
  list(@Query() query: AdminListDuelsQueryDto): Promise<DuelDto[]> {
    return this.duels.adminList(query.state, query.limit ?? 50);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel an active duel',
    description:
      'No rating change. The host bot leaves the lobby on its next tick.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelDto })
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<DuelDto> {
    return this.duels.adminCancel(id);
  }

  @Post(':id/resolve')
  @ApiOperation({
    summary: 'Resolve a FAILED / CANCELLED duel by hand',
    description:
      'With `winnerId` applies ±25 like a normal result; without it voids the duel.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DuelDto })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminResolveDuelDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelDto> {
    return this.duels.adminResolve(
      id,
      body.winnerId ?? null,
      req.user.playerId,
    );
  }
}
