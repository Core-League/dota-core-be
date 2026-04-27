import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OwnPlayerGuard } from '../auth/guards/own-player.guard';
import { PlayersService } from './players.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Post()
  create(@Body() body: CreatePlayerDto) {
    return this.playersService.create(body);
  }

  @Get()
  findAll() {
    return this.playersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.playersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, OwnPlayerGuard)
  @ApiBearerAuth()
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePlayerDto,
  ) {
    return this.playersService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, OwnPlayerGuard)
  @ApiBearerAuth()
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.playersService.remove(id);
  }
}
