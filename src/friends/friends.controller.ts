import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateFriendRequestDto,
  FriendRelationDto,
  FriendsOverviewDto,
} from './dto/friends.dto';
import { FriendsService } from './friends.service';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('friends')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  @ApiOperation({
    summary: 'My friends and open requests',
    description:
      'Friends (with 1v1 rating), requests waiting for me and requests I sent.',
  })
  @ApiOkResponse({ type: FriendsOverviewDto })
  getMine(@Req() req: AuthedRequest): Promise<FriendsOverviewDto> {
    return this.friends.overview(req.user.playerId);
  }

  @Get('relation/:playerId')
  @ApiOperation({
    summary: 'How I relate to a player (none / friends / incoming / outgoing)',
  })
  @ApiParam({ name: 'playerId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: FriendRelationDto })
  getRelation(
    @Param('playerId', ParseUUIDPipe) playerId: string,
    @Req() req: AuthedRequest,
  ): Promise<FriendRelationDto> {
    return this.friends.relationWith(req.user.playerId, playerId);
  }

  @Post('requests')
  @ApiOperation({
    summary: 'Send a friend request',
    description:
      '409 when already friends or a request is already open. Answering an incoming request ' +
      'with a request of your own accepts it.',
  })
  @ApiOkResponse({ type: FriendsOverviewDto })
  sendRequest(
    @Body() body: CreateFriendRequestDto,
    @Req() req: AuthedRequest,
  ): Promise<FriendsOverviewDto> {
    return this.friends.sendRequest(req.user.playerId, body.playerId);
  }

  @Post('requests/:id/accept')
  @ApiOperation({ summary: 'Accept a friend request (addressee only)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: FriendsOverviewDto })
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<FriendsOverviewDto> {
    return this.friends.acceptRequest(req.user.playerId, id);
  }

  @Post('requests/:id/decline')
  @ApiOperation({ summary: 'Decline a friend request (addressee only)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: FriendsOverviewDto })
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<FriendsOverviewDto> {
    return this.friends.declineRequest(req.user.playerId, id);
  }

  @Delete('requests/:id')
  @ApiOperation({ summary: 'Withdraw my friend request (requester only)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: FriendsOverviewDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<FriendsOverviewDto> {
    return this.friends.cancelRequest(req.user.playerId, id);
  }

  @Delete(':playerId')
  @ApiOperation({ summary: 'Remove a player from my friends' })
  @ApiParam({ name: 'playerId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: FriendsOverviewDto })
  remove(
    @Param('playerId', ParseUUIDPipe) playerId: string,
    @Req() req: AuthedRequest,
  ): Promise<FriendsOverviewDto> {
    return this.friends.removeFriend(req.user.playerId, playerId);
  }
}
