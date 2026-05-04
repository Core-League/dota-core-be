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
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithJwtActor } from '../auth/guards/own-player-or-admin.guard';
import { QualificationService } from '../qualification/qualification.service';
import { SubmitMatchDto } from '../qualification/dto/submit-match.dto';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import {
  createDiskStorage,
  imageFileFilter,
  UploadsService,
} from '../uploads/uploads.service';

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
    return this.tournamentsService.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.tournamentsService.remove(id);
  }

  @Get(':id/qualification')
  getQualification(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.qualificationService.getByTournamentId(id);
  }

  @Post(':id/join')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async join(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithJwtActor,
  ): Promise<void> {
    await this.qualificationService.joinTournament(id, req.user!.playerId);
  }

  @Post(':id/qualification/matches/:matchId/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async submitMatch(
    @Param('id', new ParseUUIDPipe()) _tournamentId: string,
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Body() body: SubmitMatchDto,
    @Req() req: RequestWithJwtActor,
  ) {
    return this.qualificationService.submitMatch(matchId, body.dotaMatchId, req.user!.playerId);
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
