import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import {
  NotificationStatus,
  NotificationType,
} from '../notification.constants';

/** Compact card of the player who triggered the notification. */
export class NotificationActorDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  discordName: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordUsername: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;
}

export class NotificationDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

  @ApiPropertyOptional({
    nullable: true,
    enum: NotificationStatus,
    description:
      'Outcome of the request / challenge the entry is about; `pending` means the buttons are still live',
  })
  status: NotificationStatus | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'friendship.id (friend_request*) or duel_challenge.id (duel_challenge*)',
  })
  refId: string | null;

  @ApiPropertyOptional({ type: NotificationActorDto, nullable: true })
  actor: NotificationActorDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Friendly duel created from an accepted challenge',
  })
  duelId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'Until when a duel challenge can be answered',
  })
  expiresAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  readAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

/** What the bell shows: newest entries first plus the unread counter. */
export class NotificationsSnapshotDto {
  @ApiProperty({ type: [NotificationDto] })
  items: NotificationDto[];

  @ApiProperty({
    description:
      'Entries without `readAt` (all of them, not only the listed ones)',
  })
  unreadCount: number;
}

export class MarkNotificationsReadDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Entries to mark as read; omitted or empty = everything',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids?: string[];
}
