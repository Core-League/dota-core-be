import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { TournamentDivision, TournamentStatus } from '../tournaments.model';

export class CreateTournamentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  prizePool?: number | null;

  @ApiProperty({ enum: TournamentDivision, enumName: 'TournamentDivision' })
  @IsEnum(TournamentDivision)
  division: TournamentDivision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  headerBannerUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  listBannerUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  tournamentSlots?: number;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  registrationStartsAt: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  registrationEndsAt: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  tournamentStartsAt: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  tournamentEndsAt: Date;

  @ApiProperty({ enum: TournamentStatus, enumName: 'TournamentStatus' })
  @IsEnum(TournamentStatus)
  tournamentStatus: TournamentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tournamentGridUrl?: string;
}
