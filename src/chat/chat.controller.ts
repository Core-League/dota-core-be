import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { ChatAccessService, type ChatViewer } from './chat-access.service';
import { ChatError, ChatService } from './chat.service';
import {
  ChatAdminThreadDto,
  ChatHistoryDto,
  ChatHistoryQueryDto,
  ChatPlayerDto,
  ChatPlayerSearchQueryDto,
} from './dto/chat.dto';

type MaybeAuthedRequest = Request & { user?: { playerId: string } | null };
type AuthedRequest = Request & { user: { playerId: string } };

/**
 * Never 401: the frontend interceptor logs the user out on 401, and a guest
 * asking for a members-only channel is a plain "no access".
 */
function toHttpError(err: unknown): unknown {
  if (!(err instanceof ChatError)) return err;
  switch (err.code) {
    case 'invalid_channel':
    case 'empty':
    case 'too_long':
      return new BadRequestException(err.message);
    case 'not_found':
      return new NotFoundException(err.message);
    default:
      return new ForbiddenException(err.message);
  }
}

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly access: ChatAccessService,
  ) {}

  @Get('messages')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Channel history',
    description:
      'Newest page first (items are returned oldest → newest), cursor `before`. Guests may read ' +
      '`general` only. New messages arrive over the `/chat` socket namespace (`chat:message`).',
  })
  @ApiOkResponse({ type: ChatHistoryDto })
  async history(
    @Query() query: ChatHistoryQueryDto,
    @Req() req: MaybeAuthedRequest,
  ): Promise<ChatHistoryDto> {
    const viewer = await this.viewerOf(req.user?.playerId);
    try {
      return await this.chat.history(
        viewer,
        query.channel,
        query.before,
        query.limit,
      );
    } catch (err) {
      throw toHttpError(err);
    }
  }

  @Get('admin/threads')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Admin support threads (admins only)',
    description:
      'One entry per player who has an admin thread, latest activity first, with the number of ' +
      'messages from the player the caller has not read.',
  })
  @ApiOkResponse({ type: [ChatAdminThreadDto] })
  async adminThreads(@Req() req: AuthedRequest): Promise<ChatAdminThreadDto[]> {
    const viewer = await this.viewerOf(req.user.playerId);
    if (!viewer) throw new ForbiddenException('Лише для адміністраторів');
    try {
      return await this.chat.adminThreads(viewer);
    } catch (err) {
      throw toHttpError(err);
    }
  }

  @Get('players')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Find players to message or mention',
    description:
      'Up to 10 players matching `q` (Discord name / username), excluding the caller. With ' +
      '`channel`, only players who can read that channel.',
  })
  @ApiOkResponse({ type: [ChatPlayerDto] })
  async searchPlayers(
    @Query() query: ChatPlayerSearchQueryDto,
    @Req() req: AuthedRequest,
  ): Promise<ChatPlayerDto[]> {
    const viewer = await this.viewerOf(req.user.playerId);
    if (!viewer) return [];
    try {
      return await this.chat.searchPlayers(viewer, query.q, query.channel);
    } catch (err) {
      throw toHttpError(err);
    }
  }

  private async viewerOf(
    playerId: string | undefined,
  ): Promise<ChatViewer | null> {
    return playerId ? this.access.resolveViewer(playerId) : null;
  }
}
