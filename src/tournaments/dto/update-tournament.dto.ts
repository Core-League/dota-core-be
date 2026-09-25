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
 *
 * `bracketType`, `hasThirdPlaceMatch` and the three finals series lengths
 * (`upperBracketFinalBestOf`, `lowerBracketFinalBestOf`, `grandFinalBestOf`)
 * are inherited on purpose: the bracket shape may be corrected until a playoff
 * row exists. `TournamentsService.update` rejects a change after that.
 *
 * `dotaLeagueId` is inherited too. It is locked while the qualification stage
 * is live (its node group cannot be moved between leagues); once the playoff
 * exists a change rebuilds the playoff mirror in the new league.
 */
export class UpdateTournamentDto extends PartialType(
  OmitType(CreateTournamentDto, ['hasQualification'] as const),
) {
  @ApiPropertyOptional({ enum: TournamentStatus, enumName: 'TournamentStatus' })
  @IsOptional()
  @IsEnum(TournamentStatus)
  tournamentStatus?: TournamentStatus;
}
