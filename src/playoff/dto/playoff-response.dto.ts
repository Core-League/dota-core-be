import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TeamResponseDto } from '../../teams/dto/team-response.dto';
import {
  SERIES_BEST_OF_OPTIONS,
  type SeriesBestOf,
  TournamentBracketType,
} from '../../tournaments/tournaments.model';

/**
 * Series length of each finals slot that exists in the live bracket. Upper-
 * and lower-bracket finals only exist in double elimination, so they are null
 * for single elimination; `grandFinal` is the grand final in double
 * elimination and the final in single elimination.
 */
export class PlayoffFinalsBestOfDto {
  @ApiPropertyOptional({ enum: SERIES_BEST_OF_OPTIONS, nullable: true })
  upperBracketFinal: SeriesBestOf | null;

  @ApiPropertyOptional({ enum: SERIES_BEST_OF_OPTIONS, nullable: true })
  lowerBracketFinal: SeriesBestOf | null;

  @ApiProperty({ enum: SERIES_BEST_OF_OPTIONS })
  grandFinal: SeriesBestOf;
}

export class PlayoffPlacementTeamDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) logoUrl: string | null;
}

/** One final standing (1 = champion). */
export class PlayoffPlacementDto {
  @ApiProperty({ enum: [1, 2, 3] })
  place: 1 | 2 | 3;

  @ApiProperty({ type: PlayoffPlacementTeamDto })
  team: PlayoffPlacementTeamDto;
}

export class PlayoffResponseDto {
  @ApiProperty()
  embedUrl: string;

  /** Bracket format of the live Challonge bracket, read from the tournament row. */
  @ApiProperty({
    enum: TournamentBracketType,
    enumName: 'TournamentBracketType',
  })
  bracketType: TournamentBracketType;

  /** Whether the bracket holds a third-place match (single elimination only). */
  @ApiProperty()
  hasThirdPlaceMatch: boolean;

  /** Series length (1 / 3 / 5) of each finals slot the bracket has. */
  @ApiProperty({ type: PlayoffFinalsBestOfDto })
  finalsBestOf: PlayoffFinalsBestOfDto;

  @ApiProperty({ type: [TeamResponseDto] })
  teams: TeamResponseDto[];

  /**
   * Final standings (1st–3rd), derived from persisted series only — no
   * Challonge call. Empty until the grand final is resolved. Third place is
   * the lower-bracket-final loser (double elimination) or the third-place
   * match winner (single elimination with such a match); otherwise omitted.
   */
  @ApiProperty({ type: [PlayoffPlacementDto] })
  placements: PlayoffPlacementDto[];
}
