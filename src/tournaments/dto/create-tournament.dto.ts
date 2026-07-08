import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
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

  @ApiProperty({
    enum: [TournamentDivision.DIVISION_I, TournamentDivision.DIVISION_II],
    enumName: 'TournamentDivision',
    description: 'DIVISION_III is retired and cannot be set',
  })
  @IsIn([TournamentDivision.DIVISION_I, TournamentDivision.DIVISION_II])
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
  @IsDateString()
  registrationStartsAt: string;

  @ApiProperty()
  @IsDateString()
  registrationEndsAt: string;

  @ApiProperty()
  @IsDateString()
  tournamentStartsAt: string;

  @ApiProperty()
  @IsDateString()
  tournamentEndsAt: string;

  @ApiProperty({
    enum: [TournamentStatus.QUALIFICATIONS, TournamentStatus.PLAYOFF],
    enumName: 'TournamentStatus',
    description: 'COMPLETED cannot be set on creation',
  })
  @IsIn([TournamentStatus.QUALIFICATIONS, TournamentStatus.PLAYOFF])
  tournamentStatus: TournamentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tournamentGridUrl?: string;
}
