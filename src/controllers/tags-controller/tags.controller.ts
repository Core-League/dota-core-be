import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../../connectors/auth/guards/admin.guard';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import type { TagView } from '../../types/entities/tags/tag';
import { TagsService } from '../../use-cases/tags/tags.service';
import { TagViewDto } from './tags.dto';

@ApiTags('admin-tags')
@Controller()
@UseGuards(JwtAuthGuard, AdminGuard)
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get('tags')
  @ApiOperation({ summary: 'List the moderation tag catalog' })
  @ApiOkResponse({ type: [TagViewDto] })
  listTags(): Promise<TagView[]> {
    return this.tagsService.listTags();
  }

  @Get('players/:playerId/tags')
  @ApiOperation({ summary: "List a player's tags" })
  @ApiOkResponse({ type: [TagViewDto] })
  getPlayerTags(@Param('playerId') playerId: string): Promise<TagView[]> {
    return this.tagsService.getPlayerTags(playerId);
  }

  @Post('players/:playerId/tags/:tagId')
  @ApiOperation({
    summary: 'Assign a tag to a player (idempotent); returns the updated list',
  })
  @ApiCreatedResponse({ type: [TagViewDto] })
  assignTag(
    @Param('playerId') playerId: string,
    @Param('tagId') tagId: string,
  ): Promise<TagView[]> {
    return this.tagsService.assignTag(playerId, tagId);
  }

  @Delete('players/:playerId/tags/:tagId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a tag from a player' })
  @ApiNoContentResponse()
  async unassignTag(
    @Param('playerId') playerId: string,
    @Param('tagId') tagId: string,
  ): Promise<void> {
    await this.tagsService.unassignTag(playerId, tagId);
  }
}
