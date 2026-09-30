import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DuelDto } from './duel.dto';

/**
 * A duel as the admin panel sees it: the public `DuelDto` plus the internal
 * bookkeeping that explains what the platform is doing with the result
 * (which bot follows it, what Valve ids it has, the last error).
 */
export class AdminDuelDto extends DuelDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      '`host_bot.id` of the bot that hosts / follows the duel; null while PENDING or once the bot let go',
  })
  hostBotId: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Dota lobby id from the Game Coordinator',
  })
  lobbyId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Game server SteamID once the match launched — the live scoreboard the result is read from',
  })
  serverSteamId: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Valve `EMatchOutcome` once known (2 Radiant, 3 Dire)',
  })
  matchOutcome: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When the rating change was applied; null until the result is in',
  })
  ratingAppliedAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Last technical note the bot / API left on the duel',
  })
  error: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Admin who resolved or voided the duel by hand',
  })
  resolvedByAdminId: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

/** What `DELETE /admin/duels` removed. */
export class AdminPurgeDuelsResultDto {
  @ApiProperty({ description: 'Duel rows deleted' })
  duels: number;

  @ApiProperty({
    description: 'Rating lines deleted (everyone starts from 0 again)',
  })
  ratings: number;

  @ApiProperty({ description: 'Queue entries deleted' })
  queue: number;
}
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DuelState, HostBotStatus } from '../duel.constants';

export class AdminListDuelsQueryDto {
  @ApiPropertyOptional({ enum: DuelState })
  @IsOptional()
  @IsEnum(DuelState)
  state?: DuelState;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class AdminResolveDuelDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Player to credit with the win (±25 applied). null / omitted voids the duel without rating changes.',
  })
  @IsOptional()
  @IsUUID()
  winnerId?: string | null;
}

export class AdminSetDuelRatingDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  rating: number;
}

export class CreateHostBotDto {
  @ApiProperty({
    description: 'Steam login of the bot account (Steam Guard must be off)',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  accountName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;

  @ApiPropertyOptional({
    default: 3,
    description: 'Valve server region (3 = EU West)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  region?: number;
}

export class UpdateHostBotDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'New password; re-encrypted on save' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password?: string;
}

export class HostBotDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  accountName: string;

  @ApiPropertyOptional({ nullable: true })
  steamId64: string | null;

  @ApiProperty()
  region: number;

  @ApiProperty({ enum: HostBotStatus })
  status: HostBotStatus;

  @ApiPropertyOptional({ nullable: true })
  currentDuelId: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastError: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  lastHeartbeatAt: Date | null;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty({
    description:
      'true when the worker touched this row within the last 30 s — the process is alive',
  })
  alive: boolean;
}
