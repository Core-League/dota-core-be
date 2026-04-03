import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlayerDto {
  @ApiProperty()
  steamId: string;

  @ApiProperty()
  discordId: string;

  @ApiProperty()
  telegramId: string;

  @ApiPropertyOptional()
  avatarUrl?: string;

  @ApiProperty()
  discordName: string;

  @ApiProperty()
  discordUsername: string;

  @ApiProperty()
  rating: number;
}
