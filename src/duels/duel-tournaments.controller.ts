import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
  createDiskStorage,
  imageFileFilter,
  UploadsService,
} from '../uploads/uploads.service';
import { DuelLeaderboardDto } from './dto/duel.dto';
import {
  CreateDuelTournamentDto,
  DuelTournamentDto,
  DuelTournamentPrizeImageDto,
  JoinDuelTournamentDto,
  UpdateDuelTournamentDto,
} from './dto/duel-tournament.dto';
import { DuelTournamentsService } from './duel-tournaments.service';

type AuthedRequest = Request & { user: { playerId: string } };
type MaybeAuthedRequest = Request & { user: { playerId: string } | null };

/** `uploads/<category>` the prize images are stored in. */
const PRIZE_IMAGES_CATEGORY = 'duel-tournaments';

/**
 * Password-protected 1v1 stream tournaments. A prefix of its own (not
 * `/duels/…`) so these routes can never be swallowed by `GET /duels/:id`.
 */
@ApiTags('duels')
@Controller('duel-tournaments')
export class DuelTournamentsController {
  constructor(
    private readonly tournaments: DuelTournamentsService,
    private readonly uploads: UploadsService,
  ) {}

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
    summary:
      'Create a password-protected stream tournament (streamer or admin)',
    description: '403 when a non-admin puts VIP on a prize place.',
  })
  @ApiOkResponse({ type: DuelTournamentDto })
  create(
    @Body() body: CreateDuelTournamentDto,
    @Req() req: AuthedRequest,
  ): Promise<DuelTournamentDto> {
    return this.tournaments.create(req.user.playerId, body);
  }

  @Post('prize-image')
  @UseGuards(JwtAuthGuard, MediaOrAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload a custom prize image (streamer or admin)',
    description:
      'Multipart field `file`, image/*, max 10 MB. Put the returned url into `prizes[].imageUrl`.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: DuelTournamentPrizeImageDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: createDiskStorage(PRIZE_IMAGES_CATEGORY),
      fileFilter: imageFileFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadPrizeImage(
    @UploadedFile() file: Express.Multer.File,
  ): DuelTournamentPrizeImageDto {
    if (!file) throw new BadRequestException('No file uploaded');
    return { url: this.uploads.buildUrl(PRIZE_IMAGES_CATEGORY, file.filename) };
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
    summary: 'Rename a tournament, change its password or its prize places',
    description:
      'Organiser or admin, while the tournament is ACTIVE. `prizes` replaces all places; ' +
      'VIP places may be added, changed or removed by admins only (403).',
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

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a tournament (admin)',
    description:
      'Closes its queue, cancels its duels that have not started, then deletes it with its table. ' +
      'Games already running finish without any rating change; past duels stay in the history. Irreversible.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    await this.tournaments.remove(id, req.user.playerId);
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
