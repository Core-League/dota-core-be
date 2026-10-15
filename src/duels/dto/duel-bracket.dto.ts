import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DUEL_BRACKET_MAX_PARTICIPANTS,
  DUEL_BRACKET_MIN_PARTICIPANTS,
  DUEL_BRACKET_PRIZE_PLACE_MAX,
  DuelBracketMatchResult,
  DuelBracketMatchStatus,
  DuelBracketSeeding,
  DuelBracketStatus,
} from '../duel.constants';
import { DuelDto, DuelPlayerDto } from './duel.dto';
import {
  DuelTournamentPrizeDto,
  DuelTournamentPrizeInputDto,
} from './duel-tournament.dto';

const NAME_MIN = 3;
const NAME_MAX = 64;
const DESCRIPTION_MAX = 2000;
const PASSWORD_MIN = 4;
const PASSWORD_MAX = 32;
const STREAM_URL_MAX = 512;

/** Trims a string; an empty one becomes null (clears the field). */
const toNullableText = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** One bracket tournament as the media list shows it. */
export class DuelBracketSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ enum: DuelBracketStatus })
  status: DuelBracketStatus;

  @ApiProperty({ description: 'Registration closes at this many players' })
  maxParticipants: number;

  @ApiProperty()
  participantsCount: number;

  @ApiProperty({ description: 'Registration needs a password' })
  hasPassword: boolean;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'Planned start announced by the organiser',
  })
  scheduledAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Stream link (http/https)',
  })
  streamUrl: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  startedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  finishedAt: Date | null;

  @ApiPropertyOptional({
    type: DuelPlayerDto,
    nullable: true,
    description: 'Organiser (streamer or admin); rating is their ladder rating',
  })
  createdBy: DuelPlayerDto | null;

  @ApiPropertyOptional({
    type: DuelPlayerDto,
    nullable: true,
    description: 'Champion, once FINISHED',
  })
  winner: DuelPlayerDto | null;

  @ApiProperty({ description: 'Rounds of the bracket; 0 before the launch' })
  rounds: number;

  @ApiProperty({
    type: DuelTournamentPrizeDto,
    isArray: true,
    description: 'Prize places 1–4, by place',
  })
  prizes: DuelTournamentPrizeDto[];

  @ApiProperty({ description: 'The viewer is registered' })
  joined: boolean;

  @ApiProperty({ description: 'The viewer may manage it (organiser or admin)' })
  canManage: boolean;
}

export class DuelBracketParticipantDto {
  @ApiProperty({ type: DuelPlayerDto })
  player: DuelPlayerDto;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: '1 = top seed; null before the launch',
  })
  seed: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      'Final place (best of a shared range: 5 = places 5–8); null while still in the bracket',
  })
  place: number | null;

  @ApiProperty({ description: 'Knocked out of the bracket' })
  eliminated: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  joinedAt: Date;
}

export class DuelBracketMatchDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: '1-based; the final is the last round' })
  round: number;

  @ApiProperty({ description: '0-based position inside the round' })
  position: number;

  @ApiProperty()
  isThirdPlace: boolean;

  @ApiProperty({ enum: DuelBracketMatchStatus })
  status: DuelBracketMatchStatus;

  @ApiPropertyOptional({ nullable: true, enum: DuelBracketMatchResult })
  result: DuelBracketMatchResult | null;

  @ApiPropertyOptional({ type: DuelPlayerDto, nullable: true })
  player1: DuelPlayerDto | null;

  @ApiPropertyOptional({ type: DuelPlayerDto, nullable: true })
  player2: DuelPlayerDto | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  seed1: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  seed2: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  winnerId: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  loserId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Why the match waits (organiser decision / busy player)',
  })
  note: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  finishedAt: Date | null;

  @ApiPropertyOptional({
    type: DuelDto,
    nullable: true,
    description:
      'Current (or last) duel of the match. `lobbyPassword` is filled for its players and the managers while the lobby is open.',
  })
  duel: DuelDto | null;

  @ApiProperty({ description: 'The viewer asked to watch this match' })
  spectating: boolean;
}

/** One bracket tournament with everything its page shows. */
export class DuelBracketDto extends DuelBracketSummaryDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Registration password — managers only',
  })
  password: string | null;

  @ApiPropertyOptional({ nullable: true, enum: DuelBracketSeeding })
  seeding: DuelBracketSeeding | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  prizesAwardedAt: Date | null;

  @ApiProperty({
    type: DuelBracketParticipantDto,
    isArray: true,
    description: 'By seed after the launch, by registration before',
  })
  participants: DuelBracketParticipantDto[];

  @ApiProperty({
    type: DuelBracketMatchDto,
    isArray: true,
    description: 'Every node, by round then position',
  })
  matches: DuelBracketMatchDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: "The viewer's unfinished match",
  })
  myMatchId: string | null;

  @ApiProperty({
    description:
      'The viewer has a linked Steam account (needed to play / spectate)',
  })
  viewerHasSteam: boolean;
}

export class CreateDuelBracketDto {
  @ApiProperty({ minLength: NAME_MIN, maxLength: NAME_MAX })
  @IsString()
  @MinLength(NAME_MIN)
  @MaxLength(NAME_MAX)
  name: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: DESCRIPTION_MAX,
  })
  @IsOptional()
  @Transform(toNullableText)
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    minLength: PASSWORD_MIN,
    maxLength: PASSWORD_MAX,
    description: 'Registration password; empty = open registration',
  })
  @IsOptional()
  @Transform(toNullableText)
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password?: string | null;

  @ApiProperty({
    minimum: DUEL_BRACKET_MIN_PARTICIPANTS,
    maximum: DUEL_BRACKET_MAX_PARTICIPANTS,
  })
  @IsInt()
  @Min(DUEL_BRACKET_MIN_PARTICIPANTS)
  @Max(DUEL_BRACKET_MAX_PARTICIPANTS)
  maxParticipants: number;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @Transform(toNullableText)
  @IsDateString()
  scheduledAt?: string | null;

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

  @ApiPropertyOptional({
    type: DuelTournamentPrizeInputDto,
    isArray: true,
    maxItems: DUEL_BRACKET_PRIZE_PLACE_MAX,
    description: `Places 1–${DUEL_BRACKET_PRIZE_PLACE_MAX}, unique; VIP — admins only`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DUEL_BRACKET_PRIZE_PLACE_MAX)
  @ValidateNested({ each: true })
  @Type(() => DuelTournamentPrizeInputDto)
  prizes?: DuelTournamentPrizeInputDto[];
}

/**
 * Every field optional; absent keeps it. Password and size only during
 * registration; the rest until the bracket is over.
 */
export class UpdateDuelBracketDto {
  @ApiPropertyOptional({ minLength: NAME_MIN, maxLength: NAME_MAX })
  @IsOptional()
  @IsString()
  @MinLength(NAME_MIN)
  @MaxLength(NAME_MAX)
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: DESCRIPTION_MAX,
    description: 'null / empty clears it',
  })
  @IsOptional()
  @Transform(toNullableText)
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    minLength: PASSWORD_MIN,
    maxLength: PASSWORD_MAX,
    description: 'null / empty opens the registration',
  })
  @IsOptional()
  @Transform(toNullableText)
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password?: string | null;

  @ApiPropertyOptional({
    minimum: DUEL_BRACKET_MIN_PARTICIPANTS,
    maximum: DUEL_BRACKET_MAX_PARTICIPANTS,
  })
  @IsOptional()
  @IsInt()
  @Min(DUEL_BRACKET_MIN_PARTICIPANTS)
  @Max(DUEL_BRACKET_MAX_PARTICIPANTS)
  maxParticipants?: number;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @Transform(toNullableText)
  @IsDateString()
  scheduledAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: STREAM_URL_MAX,
    description: 'null / empty clears it',
  })
  @IsOptional()
  @Transform(toNullableText)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(STREAM_URL_MAX)
  streamUrl?: string | null;

  @ApiPropertyOptional({
    type: DuelTournamentPrizeInputDto,
    isArray: true,
    maxItems: DUEL_BRACKET_PRIZE_PLACE_MAX,
    description: 'Replaces all prize places; VIP places — admins only',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DUEL_BRACKET_PRIZE_PLACE_MAX)
  @ValidateNested({ each: true })
  @Type(() => DuelTournamentPrizeInputDto)
  prizes?: DuelTournamentPrizeInputDto[];
}

export class JoinDuelBracketDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: PASSWORD_MAX,
    description: 'Required when the bracket has a password',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password?: string | null;
}

export class StartDuelBracketDto {
  @ApiPropertyOptional({
    enum: DuelBracketSeeding,
    default: DuelBracketSeeding.RANDOM,
  })
  @IsOptional()
  @IsEnum(DuelBracketSeeding)
  seeding?: DuelBracketSeeding;
}

export class SetDuelBracketWinnerDto {
  @ApiProperty({ description: 'One of the two players of the match' })
  @IsUUID()
  winnerId: string;
}
