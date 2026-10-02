import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CHAT_HISTORY_MAX_LIMIT, ChatChannelKind } from '../chat.constants';

/** Compact card of a player shown next to a message (author, mention, DM peer). */
export class ChatPlayerDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  discordName: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordUsername: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Holds an admin role (Адмін / IT)' })
  isAdmin: boolean;
}

export class ChatMessageDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    description:
      '`general` | `captains` | `duel` | `vip` | `admin:<ownerId>` | `dm:<minPlayerId>:<maxPlayerId>`',
  })
  channelKey: string;

  @ApiProperty({ enum: ChatChannelKind, enumName: 'ChatChannelKind' })
  channelKind: ChatChannelKind;

  @ApiProperty({ type: ChatPlayerDto })
  author: ChatPlayerDto;

  @ApiProperty({ description: 'Plain text, never HTML' })
  body: string;

  @ApiProperty({
    type: [ChatPlayerDto],
    description: 'Players mentioned as `@<discordName>` in the body',
  })
  mentions: ChatPlayerDto[];

  @ApiProperty({
    type: [String],
    description:
      'Ids of players tagged by `@online` (everyone connected to the public channel at send time)',
  })
  onlineMentionIds: string[];

  @ApiPropertyOptional({
    type: ChatPlayerDto,
    nullable: true,
    description: 'Owner of the admin thread (`admin` channels only)',
  })
  threadOwner: ChatPlayerDto | null;

  @ApiPropertyOptional({
    type: [ChatPlayerDto],
    nullable: true,
    description: 'Both players of a direct thread (`dm` channels only)',
  })
  participants: ChatPlayerDto[] | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class ChatHistoryQueryDto {
  @ApiProperty({ description: 'Channel key, e.g. `general` or `dm:<a>:<b>`' })
  @IsString()
  @MaxLength(96)
  channel: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Cursor: only messages strictly older than this',
  })
  @IsOptional()
  @IsDateString()
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: CHAT_HISTORY_MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CHAT_HISTORY_MAX_LIMIT)
  limit?: number;
}

export class ChatHistoryDto {
  @ApiProperty({ type: [ChatMessageDto], description: 'Oldest first' })
  items: ChatMessageDto[];

  @ApiProperty({ description: 'Older messages exist before the first item' })
  hasMore: boolean;
}

export class ChatAdminThreadDto {
  @ApiProperty({ description: '`admin:<ownerId>`' })
  channelKey: string;

  @ApiProperty({ type: ChatPlayerDto })
  owner: ChatPlayerDto;

  @ApiProperty({ type: ChatMessageDto })
  lastMessage: ChatMessageDto;

  @ApiProperty({
    description: 'Messages of the owner the caller has not read yet',
  })
  unread: number;
}

export class ChatPlayerSearchQueryDto {
  @ApiPropertyOptional({ description: 'Part of the Discord name / username' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  q?: string;

  @ApiPropertyOptional({
    description:
      'Only players who can read this channel (mention autocomplete), e.g. `captains`',
  })
  @IsOptional()
  @IsString()
  @MaxLength(96)
  channel?: string;
}

/** Unread state of one channel, as pushed in `chat:unread`. */
export class ChatUnreadChannelDto {
  @ApiProperty()
  channelKey: string;

  @ApiProperty({ enum: ChatChannelKind, enumName: 'ChatChannelKind' })
  channelKind: ChatChannelKind;

  @ApiProperty({ description: 'Unread messages (not written by the caller)' })
  unread: number;

  @ApiProperty({ description: 'Unread messages mentioning the caller' })
  mentions: number;

  @ApiPropertyOptional({
    type: ChatPlayerDto,
    nullable: true,
    description: 'The other player of a `dm` channel',
  })
  peer: ChatPlayerDto | null;
}
