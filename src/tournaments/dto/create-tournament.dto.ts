import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
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

  @ApiPropertyOptional({
    description:
      'Entry fee in kopecks. null or 0 means the tournament is free (no payment gate).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  entryFee?: number | null;

  @ApiPropertyOptional({
    description:
      'Monobank jar link captains are redirected to for the entry fee. Empty falls back to MONOBANK_JAR_URL.',
  })
  @IsOptional()
  @IsString()
  paymentJarUrl?: string | null;

  @ApiProperty({
    enum: TournamentDivision,
    enumName: 'TournamentDivision',
    description:
      'DIVISION_I = Початковий (avg 0–3500, player cap 5500), DIVISION_II = Любительський (avg 0–7000), DIVISION_III = Аматорський (avg 7000+)',
  })
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
