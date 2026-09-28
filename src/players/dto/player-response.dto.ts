import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TournamentFormat, type PlayerPosition } from '../player.entity';
import { PlayerRankDto } from './player-rank.dto';

export class PlayerRolePublicDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  isAdminRole: boolean;

  @ApiProperty({
    description: 'CSS hex #RRGGBB (для parseHexColor на клієнті)',
    example: '#2563EB',
  })
  color: string;
}

export class PlayerResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  steamId: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordId: string | null;

  @ApiPropertyOptional({ nullable: true })
  telegramId: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordName: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordUsername: string | null;

  @ApiProperty()
  rating: number;

  @ApiProperty({ type: PlayerRankDto })
  rank: PlayerRankDto;

  @ApiPropertyOptional({
    description: 'Dota map / roles (1–5)',
    type: [Number],
    enum: [1, 2, 3, 4, 5],
    isArray: true,
    nullable: true,
  })
  positions: PlayerPosition[] | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO 3166-1 alpha-2 country code',
    example: 'UA',
  })
  countryCode: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Kyiv' })
  city: string | null;

  @ApiPropertyOptional({
    description: 'Tournament formats the player wants to attend',
    enum: TournamentFormat,
    isArray: true,
    nullable: true,
  })
  wantToPlay: TournamentFormat[] | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  verifiedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  teamId: string | null;

  @ApiProperty({ type: [PlayerRolePublicDto] })
  roles: PlayerRolePublicDto[];
}
