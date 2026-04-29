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
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithJwtActor } from '../auth/guards/own-player-or-admin.guard';
import {
  createDiskStorage,
  imageFileFilter,
  UploadsService,
} from '../uploads/uploads.service';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

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
  create(@Body() body: CreateTeamDto, @Req() req: RequestWithJwtActor) {
    return this.teamsService.createTeam(body, req.user!.playerId);
  }

  @Get()
  findAll() {
    return this.teamsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.teamsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateTeamDto,
  ) {
    return this.teamsService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.teamsService.remove(id);
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
    if (!file) throw new BadRequestException('No file uploaded');
    const url = this.uploadsService.buildUrl('teams', file.filename);
    await this.teamsService.update(id, { logoUrl: url } as any);
    return { url };
  }
}
