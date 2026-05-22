import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
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
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import type { RequestWithJwtActor } from '../auth/guards/own-player-or-admin.guard';
import { QualificationService } from '../qualification/qualification.service';
import { SubmitMatchDto } from '../qualification/dto/submit-match.dto';
import { QualificationResponseDto } from '../qualification/dto/qualification-response.dto';
import { TeamResponseDto } from '../teams/dto/team-response.dto';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { JoinTournamentDto } from './dto/join-tournament.dto';
import { PlayoffTeamsDto } from './dto/playoff-teams.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import {
  createDiskStorage,
  imageFileFilter,
  UploadsService,
} from '../uploads/uploads.service';
import { PlayoffService } from '../playoff/playoff.service';
import { PlayoffResponseDto } from '../playoff/dto/playoff-response.dto';
import { SubmitPlayoffMatchDto } from '../playoff/dto/submit-playoff-match.dto';
import { DisqualifyTeamDto } from '../playoff/dto/disqualify-team.dto';
import { TechLossPlayoffDto } from '../playoff/dto/tech-loss-playoff.dto';
import { OpenPlayoffMatchDto } from '../playoff/dto/open-playoff-match.dto';

const IMAGE_INTERCEPTOR_OPTIONS = {
  fileFilter: imageFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
};

const FILE_API_BODY = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
};

@ApiTags('tournaments')
@Controller('tournaments')
export class TournamentsController {
  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly uploadsService: UploadsService,
    private readonly qualificationService: QualificationService,
    private readonly playoffService: PlayoffService,
  ) {}

  @Post()
  create(@Body() body: CreateTournamentDto) {
    return this.tournamentsService.create(body);
  }

  @Get()
  findAll() {
    return this.tournamentsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tournamentsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateTournamentDto,
  ) {
    const {
      registrationStartsAt,
      registrationEndsAt,
      tournamentStartsAt,
      tournamentEndsAt,
      ...rest
    } = body;
    return this.tournamentsService.update(id, {
      ...rest,
      ...(registrationStartsAt !== undefined && {
        registrationStartsAt: new Date(registrationStartsAt),
      }),
      ...(registrationEndsAt !== undefined && {
        registrationEndsAt: new Date(registrationEndsAt),
      }),
      ...(tournamentStartsAt !== undefined && {
        tournamentStartsAt: new Date(tournamentStartsAt),
      }),
      ...(tournamentEndsAt !== undefined && {
        tournamentEndsAt: new Date(tournamentEndsAt),
      }),
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.tournamentsService.remove(id);
  }

  @Get(':id/qualification')
  @ApiOkResponse({ type: QualificationResponseDto })
  getQualification(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.qualificationService.getByTournamentId(id);
  }

  @Post(':id/join')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({
    description:
      'Після успішного join повертає актуальний турнір з оновленим списком teams (зручно для UI без другого запиту).',
  })
  async join(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: JoinTournamentDto,
    @Req() req: RequestWithJwtActor,
  ) {
    await this.qualificationService.joinTournament(
      id,
      req.user!.playerId,
      body?.teamId,
    );
    return this.tournamentsService.findOne(id);
  }

  @Post(':id/leave')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({
    description:
      'Після успішного leave повертає актуальний турнір з оновленим списком teams.',
  })
  async leave(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: JoinTournamentDto,
    @Req() req: RequestWithJwtActor,
  ) {
    await this.qualificationService.leaveTournament(
      id,
      req.user!.playerId,
      body?.teamId,
    );
    return this.tournamentsService.findOne(id);
  }

  @Post(':id/qualification/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async submitMatch(
    @Param('id', new ParseUUIDPipe()) tournamentId: string,
    @Body() body: SubmitMatchDto,
    @Req() req: RequestWithJwtActor,
  ) {
    return this.qualificationService.submitMatch(
      tournamentId,
      body.dotaMatchId,
      req.user!.playerId,
    );
  }

  @Get(':id/qualification/teams')
  @ApiOkResponse({ type: [TeamResponseDto] })
  getQualificationTeams(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tournamentsService.getQualificationTeams(id);
  }

  @Get(':id/playoff/teams')
  @ApiOkResponse({ type: [TeamResponseDto] })
  getPlayoffTeams(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tournamentsService.getPlayoffTeams(id);
  }

  @Post(':id/playoff/teams')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: [TeamResponseDto] })
  addPlayoffTeams(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PlayoffTeamsDto,
  ) {
    return this.tournamentsService.addPlayoffTeams(id, body.teamIds ?? []);
  }

  @Delete(':id/playoff/teams')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: [TeamResponseDto] })
  removePlayoffTeams(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PlayoffTeamsDto,
  ) {
    return this.tournamentsService.removePlayoffTeams(id, body.teamIds ?? []);
  }

  @Post(':id/playoff/start')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: PlayoffResponseDto })
  startPlayoff(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PlayoffTeamsDto,
  ) {
    return this.playoffService.startPlayoff(id, body.teamIds ?? []);
  }

  @Post(':id/playoff/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  submitPlayoffMatch(
    @Param('id', new ParseUUIDPipe()) tournamentId: string,
    @Body() body: SubmitPlayoffMatchDto,
  ) {
    return this.playoffService.submitMatch(tournamentId, body.dotaMatchId);
  }

  @Post(':id/playoff/disqualify')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: PlayoffResponseDto })
  disqualifyTeam(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DisqualifyTeamDto,
  ) {
    return this.playoffService.disqualifyTeam(id, body.teamId);
  }

  @Get(':id/playoff/open-matches')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: [OpenPlayoffMatchDto] })
  getOpenPlayoffMatches(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.playoffService.getOpenMatches(id);
  }

  @Post(':id/playoff/tech-loss')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: PlayoffResponseDto })
  techLossMatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: TechLossPlayoffDto,
  ) {
    return this.playoffService.techLossMatch(id, body);
  }

  @Get(':id/playoff')
  @ApiOkResponse({ type: PlayoffResponseDto })
  getPlayoff(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.playoffService.getPlayoff(id);
  }

  @Post(':id/header-banner')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_API_BODY)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: createDiskStorage('tournaments'),
      ...IMAGE_INTERCEPTOR_OPTIONS,
    }),
  )
  async uploadHeaderBanner(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = this.uploadsService.buildUrl('tournaments', file.filename);
    await this.tournamentsService.update(id, { headerBannerUrl: url });
    return { url };
  }

  @Post(':id/list-banner')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_API_BODY)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: createDiskStorage('tournaments'),
      ...IMAGE_INTERCEPTOR_OPTIONS,
    }),
  )
  async uploadListBanner(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = this.uploadsService.buildUrl('tournaments', file.filename);
    await this.tournamentsService.update(id, { listBannerUrl: url });
    return { url };
  }

  @Post(':id/grid')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_API_BODY)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: createDiskStorage('tournaments'),
      ...IMAGE_INTERCEPTOR_OPTIONS,
    }),
  )
  async uploadGrid(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = this.uploadsService.buildUrl('tournaments', file.filename);
    await this.tournamentsService.update(id, { tournamentGridUrl: url });
    return { url };
  }
}
