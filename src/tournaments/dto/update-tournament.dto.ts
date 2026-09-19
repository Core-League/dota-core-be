import { ApiPropertyOptional } from '@nestjs/swagger';
import { OmitType, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { TournamentStatus } from '../tournaments.model';
import { CreateTournamentDto } from './create-tournament.dto';

/**
 * `hasQualification` is deliberately omitted: the qualification stage is fixed at
 * creation so a tournament can never be stripped of qualification data it already
 * holds, nor grow a stage mid-flight. The global `forbidNonWhitelisted` turns an
 * attempt to send it into a 400 rather than a silent no-op.
 */
export class UpdateTournamentDto extends PartialType(
  OmitType(CreateTournamentDto, ['hasQualification'] as const),
) {
  @ApiPropertyOptional({ enum: TournamentStatus, enumName: 'TournamentStatus' })
  @IsOptional()
  @IsEnum(TournamentStatus)
  tournamentStatus?: TournamentStatus;
}
