import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlayerDto {
  @ApiPropertyOptional({
    description: 'Optional until linked; omit for Discord-only placeholder flows',
  })
  steamId?: string;

  @ApiProperty()
  discordId: string;

  @ApiPropertyOptional({
    description: 'Optional until linked; omit for Discord-only placeholder flows',
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
}
