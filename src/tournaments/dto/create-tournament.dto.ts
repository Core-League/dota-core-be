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
import {
  DEFAULT_FINAL_BEST_OF,
  SERIES_BEST_OF_OPTIONS,
  type SeriesBestOf,
  TournamentBracketType,
  TournamentDivision,
  TournamentStatus,
} from '../tournaments.model';

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
    enum: TournamentDivision,
    enumName: 'TournamentDivision',
    deprecated: true,
    description:
      'Deprecated and ignored. Tournaments are open entry; this field is removed once the frontend stops sending it.',
  })
  @IsOptional()
  @IsEnum(TournamentDivision)
  division?: TournamentDivision;

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
    enum: TournamentBracketType,
    enumName: 'TournamentBracketType',
    default: TournamentBracketType.DOUBLE_ELIMINATION,
    description:
      'Формат сітки плей-оф. SINGLE_ELIMINATION — одна поразка вибиває, BO3 ' +
      'лише у фіналі. DOUBLE_ELIMINATION — верхня та нижня сітки, BO3 у ' +
      'фіналах верхньої й нижньої сіток і у гранд-фіналі. Без значення — ' +
      'DOUBLE_ELIMINATION. Можна змінити, доки не стартував плей-оф.',
  })
  @IsOptional()
  @IsEnum(TournamentBracketType)
  bracketType?: TournamentBracketType;

  @ApiPropertyOptional({
    default: false,
    description:
      'Чи проводиться матч за третє місце між переможеними у півфіналах. ' +
      'Лише для SINGLE_ELIMINATION — у DOUBLE_ELIMINATION третє місце визначає ' +
      'фінал нижньої сітки, тож true там відхиляється. Без значення — false. ' +
      'Можна змінити, доки не стартував плей-оф.',
  })
  @IsOptional()
  @IsBoolean()
  hasThirdPlaceMatch?: boolean;

  @ApiPropertyOptional({
    enum: SERIES_BEST_OF_OPTIONS,
    default: DEFAULT_FINAL_BEST_OF,
    description:
      'Формат фіналу верхньої сітки (матч перед гранд-фіналом): 1 — BO1, ' +
      '3 — BO3, 5 — BO5. Лише для DOUBLE_ELIMINATION — у SINGLE_ELIMINATION є ' +
      'тільки фінал, тож значення не використовується. Без значення — 3. ' +
      'Можна змінити, доки не стартував плей-оф.',
  })
  @IsOptional()
  @IsIn(SERIES_BEST_OF_OPTIONS)
  upperBracketFinalBestOf?: SeriesBestOf;

  @ApiPropertyOptional({
    enum: SERIES_BEST_OF_OPTIONS,
    default: DEFAULT_FINAL_BEST_OF,
    description:
      'Формат фіналу нижньої сітки: 1 — BO1, 3 — BO3, 5 — BO5. Лише для ' +
      'DOUBLE_ELIMINATION — у SINGLE_ELIMINATION значення не використовується. ' +
      'Без значення — 3. Можна змінити, доки не стартував плей-оф.',
  })
  @IsOptional()
  @IsIn(SERIES_BEST_OF_OPTIONS)
  lowerBracketFinalBestOf?: SeriesBestOf;

  @ApiPropertyOptional({
    enum: SERIES_BEST_OF_OPTIONS,
    default: DEFAULT_FINAL_BEST_OF,
    description:
      'Формат гранд-фіналу (у SINGLE_ELIMINATION — фіналу): 1 — BO1, 3 — BO3, ' +
      '5 — BO5. Без значення — 3. Можна змінити, доки не стартував плей-оф.',
  })
  @IsOptional()
  @IsIn(SERIES_BEST_OF_OPTIONS)
  grandFinalBestOf?: SeriesBestOf;

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
