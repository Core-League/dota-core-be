import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
