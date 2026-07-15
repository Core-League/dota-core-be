import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TournamentDivision,
  TournamentStatus,
} from '../../tournaments/tournaments.model';
import { PlayerResponseDto } from '../../players/dto/player-response.dto';

/** Підмножина турніру без `teams` / `eligibleRoles`, щоб уникнути циклічного JSON. */
export class TeamTournamentEmbeddedDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  prizePool: number;

  @ApiPropertyOptional({ nullable: true })
  headerBannerUrl: string | null;

  @ApiPropertyOptional({ nullable: true })
  listBannerUrl: string | null;

  @ApiPropertyOptional({ nullable: true })
  tournamentSlots: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  registrationStartsAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  registrationEndsAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  tournamentStartsAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  tournamentEndsAt: Date;

  @ApiProperty({ enum: TournamentStatus })
  tournamentStatus: TournamentStatus;

  @ApiPropertyOptional({ nullable: true })
  tournamentGridUrl: string | null;
}

export class TeamResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  logoUrl: string | null;

  @ApiPropertyOptional({ nullable: true })
  dotaTeamId: string | null;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty()
  isPlayingTournament: boolean;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  verifiedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  disbandedAt: Date | null;

  @ApiPropertyOptional({ type: PlayerResponseDto, nullable: true })
  captain: PlayerResponseDto | null;

  @ApiPropertyOptional({ type: PlayerResponseDto, nullable: true })
  coach: PlayerResponseDto | null;

  @ApiProperty({ type: [PlayerResponseDto] })
  mainPlayers: PlayerResponseDto[];

  @ApiProperty({ type: [PlayerResponseDto] })
  reservedPlayers: PlayerResponseDto[];

  @ApiProperty({ type: [TeamTournamentEmbeddedDto] })
  tournaments: TeamTournamentEmbeddedDto[];

  @ApiPropertyOptional({ enum: TournamentDivision, nullable: true })
  division: TournamentDivision | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Rounded mean rating of mainPlayers (reserves excluded). Null for an empty roster.',
  })
  avgRating: number | null;
}
