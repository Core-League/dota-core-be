import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
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

  @ApiProperty({ description: 'Початок реєстрації команд на турнір.' })
  @IsDateString()
  registrationStartsAt: string;

  @ApiProperty({ description: 'Кінець реєстрації команд на турнір.' })
  @IsDateString()
  registrationEndsAt: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Чи проводиться кваліфікація. false — без кваліфікаційного етапу: дати ' +
      'кваліфікації не передаються, слоти команд обовʼязкові й не більші за ' +
      'розмір сітки, статус QUALIFICATIONS недоступний. Змінити після ' +
      'створення не можна.',
  })
  @IsOptional()
  @IsBoolean()
  hasQualification?: boolean;

  @ApiPropertyOptional({
    description:
      'Початок вікна подачі кваліфікаційних матчів. Може перетинатися з ' +
      'реєстрацією. Обовʼязкове, якщо hasQualification не false.',
  })
  @ValidateIf((o: CreateTournamentDto) => o.hasQualification !== false)
  @IsDateString()
  qualificationStartsAt?: string;

  @ApiPropertyOptional({
    description:
      'Кінець вікна подачі кваліфікаційних матчів. Має бути не пізніше ' +
      'tournamentStartsAt. Обовʼязкове, якщо hasQualification не false.',
  })
  @ValidateIf((o: CreateTournamentDto) => o.hasQualification !== false)
  @IsDateString()
  qualificationEndsAt?: string;

  @ApiProperty({
    description: 'Початок плей-оф — момент автоматичного старту сітки.',
  })
  @IsDateString()
  tournamentStartsAt: string;

  @ApiProperty({ description: 'Кінець плей-оф / турніру.' })
  @IsDateString()
  tournamentEndsAt: string;

  @ApiProperty({
    enum: [
      TournamentStatus.REGISTRATION,
      TournamentStatus.QUALIFICATIONS,
      TournamentStatus.PLAYOFF,
    ],
    enumName: 'TournamentStatus',
    description: 'COMPLETED cannot be set on creation',
  })
  @IsIn([
    TournamentStatus.REGISTRATION,
    TournamentStatus.QUALIFICATIONS,
    TournamentStatus.PLAYOFF,
  ])
  tournamentStatus: TournamentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tournamentGridUrl?: string;
}
