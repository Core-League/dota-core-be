import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DuelTournamentStatus } from '../duel.constants';
import { DuelPlayerDto } from './duel.dto';

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
    description:
      'Organiser (media staff or admin); rating is their ladder rating',
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
}

export class JoinDuelTournamentDto {
  @ApiProperty({ maxLength: 32 })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  password: string;
}
