import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  TournamentFormat,
  type PlayerPosition,
} from '../../players/player.entity';
import { PlayerResponseDto } from '../../players/dto/player-response.dto';
import { TeamResponseDto } from '../../teams/dto/team-response.dto';
import {
  JoinRequestKind,
  JoinRequestStatus,
  RECRUITMENT_MMR_MAX,
  RECRUITMENT_PAGE_SIZE_MAX,
  RECRUITMENT_PLAYERS_NEEDED_MAX,
  RECRUITMENT_TEXT_MAX_LENGTH,
  RecruitmentBlockReason,
  TEAM_MEMBER_SLOTS,
  TeamPostStatus,
  type TeamMemberSlot,
} from '../recruitment.constants';

const POSITIONS: PlayerPosition[] = [1, 2, 3, 4, 5];

/** Query value → string list: accepts `a,b`, repeated keys and `key[]=`. */
const toStringList = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
};

const toNumberList = (input: { value: unknown }): number[] | undefined =>
  toStringList(input)?.map(Number);

const toBoolean = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
};

/** Empty string from a cleared textarea → null. */
const toNullableText = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

// ── requests ──────────────────────────────────────────────────────────────

export class CreateTeamPostDto {
  @ApiProperty({ description: 'Team the post is for (caller must manage it)' })
  @IsUUID()
  teamId: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: RECRUITMENT_TEXT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(toNullableText)
  @IsString()
  @MaxLength(RECRUITMENT_TEXT_MAX_LENGTH)
  description?: string | null;

  @ApiProperty({ type: [Number], enum: POSITIONS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(POSITIONS, { each: true })
  positions: PlayerPosition[];

  @ApiProperty({ minimum: 1, maximum: RECRUITMENT_PLAYERS_NEEDED_MAX })
  @IsInt()
  @Min(1)
  @Max(RECRUITMENT_PLAYERS_NEEDED_MAX)
  playersNeeded: number;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: RECRUITMENT_MMR_MAX,
    description: 'At least one of mmrMin / mmrMax is required',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(RECRUITMENT_MMR_MAX)
  mmrMin?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: RECRUITMENT_MMR_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(RECRUITMENT_MMR_MAX)
  mmrMax?: number | null;

  @ApiPropertyOptional({
    enum: TournamentFormat,
    isArray: true,
    description: 'Formats the team plays; empty = any',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(TournamentFormat, { each: true })
  formats?: TournamentFormat[];
}

export class UpdateTeamPostDto extends PartialType(
  OmitType(CreateTeamPostDto, ['teamId'] as const),
) {}

export class ApplyToTeamPostDto {
  @ApiProperty({
    enum: POSITIONS,
    description: 'One of the player positions the post is looking for',
  })
  @IsIn(POSITIONS)
  position: PlayerPosition;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: RECRUITMENT_TEXT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(toNullableText)
  @IsString()
  @MaxLength(RECRUITMENT_TEXT_MAX_LENGTH)
  message?: string | null;
}

export class UpsertPlayerListingDto {
  @ApiPropertyOptional({
    nullable: true,
    maxLength: RECRUITMENT_TEXT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(toNullableText)
  @IsString()
  @MaxLength(RECRUITMENT_TEXT_MAX_LENGTH)
  description?: string | null;
}

export class CreateTeamInviteRequestDto {
  @ApiProperty({ description: 'Inviting team (caller must manage it)' })
  @IsUUID()
  teamId: string;

  @ApiProperty({ description: 'Invited player (must have no team)' })
  @IsUUID()
  playerId: string;

  @ApiProperty({ enum: TEAM_MEMBER_SLOTS })
  @IsIn(TEAM_MEMBER_SLOTS)
  slot: TeamMemberSlot;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: RECRUITMENT_TEXT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(toNullableText)
  @IsString()
  @MaxLength(RECRUITMENT_TEXT_MAX_LENGTH)
  message?: string | null;
}

export class AcceptJoinRequestDto {
  @ApiPropertyOptional({
    enum: TEAM_MEMBER_SLOTS,
    description:
      'Applications only: roster slot; omitted = main if free (and not locked by a tournament), else reserved',
  })
  @IsOptional()
  @IsIn(TEAM_MEMBER_SLOTS)
  slot?: TeamMemberSlot;
}

class RecruitmentPageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: RECRUITMENT_PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RECRUITMENT_PAGE_SIZE_MAX)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Comma-separated positions 1–5',
    example: '1,2',
  })
  @IsOptional()
  @Transform(toNumberList)
  @IsIn(POSITIONS, { each: true })
  positions?: PlayerPosition[];

  @ApiPropertyOptional({
    type: String,
    description: 'Comma-separated formats ONLINE / LAN',
    example: 'ONLINE',
  })
  @IsOptional()
  @Transform(toStringList)
  @IsEnum(TournamentFormat, { each: true })
  formats?: TournamentFormat[];
}

export class TeamPostsQueryDto extends RecruitmentPageQueryDto {
  @ApiPropertyOptional({
    description: 'Only posts whose MMR range includes this value',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(RECRUITMENT_MMR_MAX)
  mmr?: number;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Only posts the caller may apply to',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  eligible?: boolean;

  @ApiPropertyOptional({ type: Boolean, description: 'Only verified teams' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  verified?: boolean;
}

export class PlayerListingsQueryDto extends RecruitmentPageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ratingFrom?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ratingTo?: number;

  @ApiPropertyOptional({
    type: String,
    description: 'Comma-separated medal tiers 1–8 (Herald … Immortal)',
    example: '5,6',
  })
  @IsOptional()
  @Transform(toNumberList)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(8, { each: true })
  ranks?: number[];

  @ApiPropertyOptional({
    type: String,
    description: 'Comma-separated LAN cities',
  })
  @IsOptional()
  @Transform(toStringList)
  @IsString({ each: true })
  lanCities?: string[];
}

// ── responses ─────────────────────────────────────────────────────────────

/** Team card of a post / request. */
export class RecruitmentTeamDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  logoUrl: string | null;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty()
  isPlayingTournament: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Mean rating of the main roster, rounded',
  })
  avgRating: number | null;

  @ApiProperty({ description: 'Captain is VIP (posts sort first)' })
  isVip: boolean;

  @ApiPropertyOptional({ nullable: true })
  captainId: string | null;

  @ApiPropertyOptional({ nullable: true })
  coachId: string | null;

  @ApiProperty()
  mainCount: number;

  @ApiProperty()
  reservedCount: number;
}

/** The caller's own pending request towards a post / listing. */
export class JoinRequestBriefDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: JoinRequestKind })
  kind: JoinRequestKind;

  @ApiProperty({ enum: JoinRequestStatus })
  status: JoinRequestStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class TeamPostDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: RecruitmentTeamDto })
  team: RecruitmentTeamDto;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiProperty({ type: [Number], enum: POSITIONS, isArray: true })
  positions: PlayerPosition[];

  @ApiProperty()
  playersNeeded: number;

  @ApiPropertyOptional({ nullable: true })
  mmrMin: number | null;

  @ApiPropertyOptional({ nullable: true })
  mmrMax: number | null;

  @ApiProperty({ enum: TournamentFormat, isArray: true })
  formats: TournamentFormat[];

  @ApiProperty({ enum: TeamPostStatus })
  status: TeamPostStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  @ApiPropertyOptional({
    type: JoinRequestBriefDto,
    nullable: true,
    description: "The caller's pending application to this team",
  })
  myApplication: JoinRequestBriefDto | null;

  @ApiProperty({
    enum: RecruitmentBlockReason,
    isArray: true,
    description: 'Why the caller cannot apply; empty = can apply',
  })
  blockReasons: RecruitmentBlockReason[];

  @ApiProperty({
    description: 'Caller is captain / coach of the team or an admin',
  })
  canManage: boolean;
}

export class TeamPostsPageDto {
  @ApiProperty({ type: [TeamPostDto] })
  items: TeamPostDto[];

  @ApiProperty()
  total: number;
}

export class PlayerListingDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({
    type: PlayerResponseDto,
    description: 'Live profile (MMR, positions, formats, city)',
  })
  player: PlayerResponseDto;

  @ApiPropertyOptional({
    type: JoinRequestBriefDto,
    nullable: true,
    description: 'Pending invite from a team the caller manages',
  })
  myTeamInvite: JoinRequestBriefDto | null;
}

export class PlayerListingsPageDto {
  @ApiProperty({ type: [PlayerListingDto] })
  items: PlayerListingDto[];

  @ApiProperty()
  total: number;
}

/** Compact card of the player who created a request. */
export class RecruitmentPlayerCardDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  discordName: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordUsername: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;
}

export class TeamPostBriefDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiProperty({ type: [Number], enum: POSITIONS, isArray: true })
  positions: PlayerPosition[];

  @ApiProperty()
  playersNeeded: number;

  @ApiPropertyOptional({ nullable: true })
  mmrMin: number | null;

  @ApiPropertyOptional({ nullable: true })
  mmrMax: number | null;

  @ApiProperty({ enum: TeamPostStatus })
  status: TeamPostStatus;
}

/** Everything the "Переглянути" modal shows. */
export class JoinRequestDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: JoinRequestKind })
  kind: JoinRequestKind;

  @ApiProperty({ enum: JoinRequestStatus })
  status: JoinRequestStatus;

  @ApiPropertyOptional({ nullable: true })
  message: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: POSITIONS,
    description: 'Position the applicant picked',
  })
  position: PlayerPosition | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: TEAM_MEMBER_SLOTS,
    description: 'Invite: offered slot. Accepted application: slot given',
  })
  slot: TeamMemberSlot | null;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  respondedAt: Date | null;

  @ApiProperty({ type: PlayerResponseDto, description: 'Live profile' })
  player: PlayerResponseDto;

  @ApiProperty({ type: TeamResponseDto })
  team: TeamResponseDto;

  @ApiPropertyOptional({ type: RecruitmentPlayerCardDto, nullable: true })
  createdBy: RecruitmentPlayerCardDto | null;

  @ApiPropertyOptional({ type: TeamPostBriefDto, nullable: true })
  post: TeamPostBriefDto | null;

  @ApiProperty({ description: 'Caller may accept / decline' })
  canRespond: boolean;

  @ApiProperty({ description: 'Caller may withdraw (cancel)' })
  canWithdraw: boolean;
}

export class ManagedTeamDto {
  @ApiProperty({ type: RecruitmentTeamDto })
  team: RecruitmentTeamDto;

  @ApiPropertyOptional({ type: TeamPostDto, nullable: true })
  post: TeamPostDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Invites left today; null = unlimited (VIP / admin)',
  })
  invitesLeft: number | null;
}

/** The caller's recruitment state. */
export class RecruitmentMeDto {
  @ApiProperty()
  isAdmin: boolean;

  @ApiPropertyOptional({ type: PlayerListingDto, nullable: true })
  listing: PlayerListingDto | null;

  @ApiProperty({
    enum: RecruitmentBlockReason,
    isArray: true,
    description: 'Why the caller cannot publish a listing; empty = can',
  })
  listingBlockReasons: RecruitmentBlockReason[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Applications left today; null = unlimited (VIP)',
  })
  applicationsLeft: number | null;

  @ApiProperty({
    type: [ManagedTeamDto],
    description: 'Teams the caller captains / coaches',
  })
  managedTeams: ManagedTeamDto[];
}
