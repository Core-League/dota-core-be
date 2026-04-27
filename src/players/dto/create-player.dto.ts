import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PlayerPosition } from '../player.entity';

export class CreatePlayerDto {
  @ApiPropertyOptional({
    description:
      'Optional until linked; omit for Discord-only placeholder flows',
  })
  steamId?: string;

  @ApiProperty()
  discordId: string;

  @ApiPropertyOptional({
    description:
      'Optional until linked; omit for Discord-only placeholder flows',
  })
  telegramId?: string;

  @ApiPropertyOptional()
  avatarUrl?: string;

  @ApiProperty()
  discordName: string;

  @ApiProperty()
  discordUsername: string;

  @ApiPropertyOptional({ default: 0 })
  rating?: number;

  @ApiPropertyOptional({
    description: 'Dota map / roles (1–5); omit or null when unset',
    type: [Number],
    enum: [1, 2, 3, 4, 5],
    isArray: true,
    nullable: true,
  })
  positions?: PlayerPosition[] | null;
}
