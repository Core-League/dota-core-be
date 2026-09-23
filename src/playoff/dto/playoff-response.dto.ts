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
}
