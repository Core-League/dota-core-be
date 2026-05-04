import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TournamentDivision, TournamentStatus } from '../tournaments.model';

export class CreateTournamentDto {
  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  prizePool?: number | null;

  @ApiProperty({ enum: TournamentDivision, enumName: 'TournamentDivision' })
  division: TournamentDivision;

  @ApiPropertyOptional()
  headerBannerUrl?: string;

  @ApiPropertyOptional()
  listBannerUrl?: string;

  @ApiPropertyOptional()
  tournamentSlots?: number;

  @ApiProperty()
  registrationStartsAt: Date;

  @ApiProperty()
  registrationEndsAt: Date;

  @ApiProperty()
  tournamentStartsAt: Date;

  @ApiProperty()
  tournamentEndsAt: Date;

  @ApiProperty({ enum: TournamentStatus, enumName: 'TournamentStatus' })
  tournamentStatus: TournamentStatus;

  @ApiPropertyOptional()
  tournamentGridUrl?: string;
}
