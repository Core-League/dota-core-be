import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  DUEL_TOURNAMENT_PRIZE_PLACE_MAX,
  DUEL_TOURNAMENT_PRIZE_VIP_MONTHS_MAX,
  DUEL_TOURNAMENT_PRIZES_MAX,
  DuelTournamentPrizeKind,
  DuelTournamentStatus,
} from '../duel.constants';
import { DuelPlayerDto } from './duel.dto';

const PRIZE_TITLE_MAX = 80;
const PRIZE_URL_MAX = 512;
const STREAM_URL_MAX = 512;

/** Trims a string; an empty one becomes null (clears the field). */
const toNullableText = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** One prize place as the tournament page and its leaderboard show it. */
export class DuelTournamentPrizeDto {
  @ApiProperty({ minimum: 1, maximum: DUEL_TOURNAMENT_PRIZE_PLACE_MAX })
  place: number;

  @ApiProperty({ enum: DuelTournamentPrizeKind })
  kind: DuelTournamentPrizeKind;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'VIP months (kind `vip`)',
  })
  vipMonths: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  title: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Prize image (kind `custom`)',
  })
  imageUrl: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Prize link (kind `custom`)',
  })
  linkUrl: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Who won the place — set once the prizes are settled (null: nobody with a played game held it)',
  })
  awardedPlayerId: string | null;
}

/** One prize place in a create / update request. */
export class DuelTournamentPrizeInputDto {
  @ApiProperty({ minimum: 1, maximum: DUEL_TOURNAMENT_PRIZE_PLACE_MAX })
  @IsInt()
  @Min(1)
  @Max(DUEL_TOURNAMENT_PRIZE_PLACE_MAX)
  place: number;

  @ApiProperty({
    enum: DuelTournamentPrizeKind,
    description: '`vip` — admins only',
  })
  @IsEnum(DuelTournamentPrizeKind)
  kind: DuelTournamentPrizeKind;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    minimum: 1,
    maximum: DUEL_TOURNAMENT_PRIZE_VIP_MONTHS_MAX,
    description: 'Required for `vip`',
  })
  @ValidateIf(
    (o: DuelTournamentPrizeInputDto) => o.kind === DuelTournamentPrizeKind.VIP,
  )
  @IsInt()
  @Min(1)
  @Max(DUEL_TOURNAMENT_PRIZE_VIP_MONTHS_MAX)
  vipMonths?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: PRIZE_TITLE_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(PRIZE_TITLE_MAX)
  title?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: PRIZE_URL_MAX,
    description:
      'Required for `custom`: the url returned by POST /duel-tournaments/prize-image',
  })
  @ValidateIf(
    (o: DuelTournamentPrizeInputDto) =>
      o.kind === DuelTournamentPrizeKind.CUSTOM,
  )
  @IsString()
  @MaxLength(PRIZE_URL_MAX)
  @Matches(/^(https?:\/\/|\/)\S+$/, { message: 'imageUrl must be a url' })
  imageUrl?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: PRIZE_URL_MAX,
    description: 'Required for `custom`: http(s) link of the prize',
  })
  @ValidateIf(
    (o: DuelTournamentPrizeInputDto) =>
      o.kind === DuelTournamentPrizeKind.CUSTOM,
  )
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(PRIZE_URL_MAX)
  linkUrl?: string | null;
}

/** One tournament as the duels page and the tournament page see it. */
export class DuelTournamentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: DuelTournamentStatus })
  status: DuelTournamentStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  endedAt: Date | null;

  @ApiPropertyOptional({
    type: DuelPlayerDto,
    nullable: true,
    description: 'Organiser (streamer or admin); rating is their ladder rating',
  })
  createdBy: DuelPlayerDto | null;

  @ApiProperty({ description: 'Players who entered the password' })
  participantsCount: number;

  @ApiProperty({ description: 'The viewer entered the password already' })
  joined: boolean;

  @ApiProperty({
    description: 'The viewer may edit / end it (organiser or admin)',
  })
  canManage: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Join password — only for managers on GET /duel-tournaments/{id}',
  })
  password: string | null;

  @ApiProperty({
    type: DuelTournamentPrizeDto,
    isArray: true,
    description: 'Prize places, by place',
  })
  prizes: DuelTournamentPrizeDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'Winners fixed and VIP granted (after the end, once no game of it is running)',
  })
  prizesAwardedAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Stream link (http/https)',
  })
  streamUrl: string | null;
}

export class CreateDuelTournamentDto {
  @ApiProperty({ minLength: 3, maxLength: 64 })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  name: string;

  @ApiProperty({ minLength: 4, maxLength: 32 })
  @IsString()
  @MinLength(4)
  @MaxLength(32)
  password: string;

  @ApiPropertyOptional({
    type: DuelTournamentPrizeInputDto,
    isArray: true,
    maxItems: DUEL_TOURNAMENT_PRIZES_MAX,
    description: 'One prize per place, places unique',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DUEL_TOURNAMENT_PRIZES_MAX)
  @ValidateNested({ each: true })
  @Type(() => DuelTournamentPrizeInputDto)
  prizes?: DuelTournamentPrizeInputDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: STREAM_URL_MAX,
    description: 'Stream link (http/https)',
  })
  @IsOptional()
  @Transform(toNullableText)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(STREAM_URL_MAX)
  streamUrl?: string | null;
}

export class UpdateDuelTournamentDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ minLength: 4, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(32)
  password?: string;

  @ApiPropertyOptional({
    type: DuelTournamentPrizeInputDto,
    isArray: true,
    maxItems: DUEL_TOURNAMENT_PRIZES_MAX,
    description:
      'Replaces all prize places. VIP places may be changed by admins only.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DUEL_TOURNAMENT_PRIZES_MAX)
  @ValidateNested({ each: true })
  @Type(() => DuelTournamentPrizeInputDto)
  prizes?: DuelTournamentPrizeInputDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: STREAM_URL_MAX,
    description: 'Stream link (http/https); null or empty string clears it',
  })
  @IsOptional()
  @Transform(toNullableText)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(STREAM_URL_MAX)
  streamUrl?: string | null;
}

export class JoinDuelTournamentDto {
  @ApiProperty({ maxLength: 32 })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  password: string;
}

/** Response of POST /duel-tournaments/prize-image. */
export class DuelTournamentPrizeImageDto {
  @ApiProperty()
  url: string;
}
