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
import type { RequestWithJwtActor } from '../auth/guards/own-player-or-admin.guard';
import type { Player } from '../players/player.entity';
import {
  createDiskStorage,
  imageFileFilter,
  UploadsService,
} from '../uploads/uploads.service';
import { TeamsService } from './teams.service';
import { AddPlayerDto } from './dto/add-player.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { SearchTeamsDto } from './dto/search-teams.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { TeamResponseDto } from './dto/team-response.dto';

const FILE_API_BODY = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
};

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(
    private readonly teamsService: TeamsService,
    private readonly uploadsService: UploadsService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: TeamResponseDto })
  create(@Body() body: CreateTeamDto, @Req() req: RequestWithJwtActor) {
    return this.teamsService.createTeam(body, req.user!.playerId);
  }

  @Get()
  @ApiOkResponse({ type: TeamResponseDto, isArray: true })
  findAll() {
    return this.teamsService.findAll();
  }

  @Post('search')
  @ApiBody({ type: SearchTeamsDto, required: false })
  search() {
    return this.teamsService.search();
  }

  @Get(':id')
  @ApiOkResponse({ type: TeamResponseDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.teamsService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: TeamResponseDto })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateTeamDto,
  ) {
    const { coachId, ...rest } = body;
    return this.teamsService.update(id, {
      ...rest,
      ...(coachId !== undefined && { coach: { id: coachId } as Player }),
    });
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.teamsService.remove(id);
  }

  @Post(':id/captain')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  changeCaptain(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { newCaptainPlayerId: string },
    @Req() req: RequestWithJwtActor,
  ) {
    return this.teamsService.changeCaptain(
      id,
      body.newCaptainPlayerId,
      req.user!.playerId,
    );
  }

  @Post(':id/invites')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  createInvite(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateInviteDto,
    @Req() req: RequestWithJwtActor,
  ): Promise<{ token: string; expiresAt: Date }> {
    return this.teamsService.createInvite(id, req.user!.playerId, body.slot);
  }

  @Post(':id/players')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  addPlayer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AddPlayerDto,
  ) {
    return this.teamsService.addPlayerToTeam(id, body.playerId, body.slot);
  }

  @Delete(':id/players/:playerId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  removePlayer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('playerId', new ParseUUIDPipe()) playerId: string,
  ) {
    return this.teamsService.removePlayerFromTeam(id, playerId);
  }

  @Post(':id/logo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_API_BODY)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: createDiskStorage('teams'),
      fileFilter: imageFileFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadLogo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException(
        'Файл не отримано. Переконайтеся, що поле multipart називається «file», і ви дійсно обрали зображення.',
      );
    }
    const url = this.uploadsService.buildUrl('teams', file.filename);
    await this.teamsService.update(id, { logoUrl: url });
    return { url };
  }
}
