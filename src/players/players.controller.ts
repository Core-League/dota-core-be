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
import {
  OwnPlayerOrAdminGuard,
  type RequestWithJwtActor,
} from '../auth/guards/own-player-or-admin.guard';
import { PlayerResponseDto } from './dto/player-response.dto';
import { PlayersService } from './players.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import {
  createDiskStorage,
  imageFileFilter,
  UploadsService,
} from '../uploads/uploads.service';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(
    private readonly playersService: PlayersService,
    private readonly uploadsService: UploadsService,
  ) {}

  @Post()
  create(@Body() body: CreatePlayerDto) {
    return this.playersService.create(body);
  }

  @Get()
  @ApiOkResponse({ type: PlayerResponseDto, isArray: true })
  findAll() {
    return this.playersService.findAll();
  }

  @Get(':id')
  @ApiOkResponse({ type: PlayerResponseDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.playersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, OwnPlayerOrAdminGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: PlayerResponseDto })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePlayerDto,
    @Req() req: RequestWithJwtActor,
  ) {
    return this.playersService.update(id, body, {
      actorHasAdminRole: req.actorHasAdminRole ?? false,
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, OwnPlayerOrAdminGuard)
  @ApiBearerAuth()
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.playersService.remove(id);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: createDiskStorage('avatars'),
      fileFilter: imageFileFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: RequestWithJwtActor,
  ): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException(
        'Файл не отримано. Переконайтеся, що поле multipart називається «file», і ви дійсно обрали зображення.',
      );
    }
    const url = this.uploadsService.buildUrl('avatars', file.filename);
    await this.playersService.update(req.user!.playerId, { avatarUrl: url });
    return { url };
  }
}
