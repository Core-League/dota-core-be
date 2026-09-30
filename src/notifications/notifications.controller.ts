import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  MarkNotificationsReadDto,
  NotificationsSnapshotDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'My notifications',
    description:
      'Newest 30 entries and the unread counter. The same snapshot is pushed over the ' +
      '`/notifications` socket namespace (`notification:snapshot`) whenever it changes.',
  })
  @ApiOkResponse({ type: NotificationsSnapshotDto })
  getMine(@Req() req: AuthedRequest): Promise<NotificationsSnapshotDto> {
    return this.notifications.snapshot(req.user.playerId);
  }

  @Post('read')
  @ApiOperation({
    summary: 'Mark notifications as read',
    description: 'Given ids, or everything unread when `ids` is omitted.',
  })
  @ApiOkResponse({ type: NotificationsSnapshotDto })
  markRead(
    @Body() body: MarkNotificationsReadDto,
    @Req() req: AuthedRequest,
  ): Promise<NotificationsSnapshotDto> {
    return this.notifications.markRead(req.user.playerId, body.ids);
  }
}
