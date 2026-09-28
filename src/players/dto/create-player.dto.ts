import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  TOURNAMENT_FORMATS,
  TournamentFormat,
  type PlayerPosition,
} from '../player.entity';

export class CreatePlayerDto {
  @ApiPropertyOptional({
    description:
      'Optional until linked; omit for Discord-only placeholder flows',
  })
  @IsOptional()
  @IsString()
  steamId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  discordId: string;

  @ApiPropertyOptional({
    description:
      'Optional until linked; omit for Discord-only placeholder flows',
  })
  @IsOptional()
  @IsString()
  telegramId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  discordName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  discordUsername: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  rating?: number;

  @ApiPropertyOptional({
    description: 'Dota map / roles (1–5); omit or null when unset',
    type: [Number],
    enum: [1, 2, 3, 4, 5],
    isArray: true,
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn([1, 2, 3, 4, 5], { each: true })
  positions?: PlayerPosition[] | null;

  @ApiPropertyOptional({
    description:
      'ISO 3166-1 alpha-2 country code from GET /locations/countries; null to clear (also clears city)',
    example: 'UA',
    nullable: true,
    minLength: 2,
    maxLength: 2,
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Za-z]{2}$/, {
    message: 'countryCode must be an ISO alpha-2 code',
  })
  countryCode?: string | null;

  @ApiPropertyOptional({
    description: 'City name from GET /locations/cities; null to clear',
    example: 'Kyiv',
    nullable: true,
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @ApiPropertyOptional({
    description:
      'Tournament formats the player wants to attend; omit or null when unset',
    enum: TournamentFormat,
    isArray: true,
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(TOURNAMENT_FORMATS, { each: true })
  wantToPlay?: TournamentFormat[] | null;

  @ApiPropertyOptional({
    description:
      'Ukrainian cities (names from GET /locations/cities?countryCode=UA) the player can travel to for LAN tournaments; ignored unless wantToPlay includes LAN',
    type: [String],
    nullable: true,
    example: ['Київ', 'Львів'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  lanCities?: string[] | null;
}
