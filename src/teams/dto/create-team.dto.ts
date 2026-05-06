import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateTeamDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'UUID of the coach player' })
  @IsOptional()
  @IsUUID()
  coachId?: string;

  @ApiPropertyOptional({ description: 'Dota 2 team ID from the game API' })
  @IsOptional()
  @IsString()
  dotaTeamId?: string;

  @ApiProperty()
  @IsBoolean()
  isVerified: boolean;

  @ApiProperty()
  @IsBoolean()
  isPlayingTournament: boolean;
}
