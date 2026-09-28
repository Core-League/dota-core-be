import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlayerRankDto } from '../../players/dto/player-rank.dto';
import {
  TournamentFormat,
  type PlayerPosition,
} from '../../players/player.entity';

export class CurrentPlayerRoleDto {
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

export class CurrentPlayerDto {
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

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Серверний nickname на DISCORD_SYNC_GUILD_ID; null якщо на сервері не заданий (показується global name / username)',
  })
  discordServerNickname: string | null;

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

  @ApiPropertyOptional({
    description:
      'Ukrainian cities the player can travel to for LAN tournaments',
    type: [String],
    nullable: true,
    example: ['Київ', 'Львів'],
  })
  lanCities: string[] | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  verifiedAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'UUID команди або null поза складом',
  })
  teamId: string | null;

  @ApiProperty({ type: [CurrentPlayerRoleDto] })
  roles: CurrentPlayerRoleDto[];
}
