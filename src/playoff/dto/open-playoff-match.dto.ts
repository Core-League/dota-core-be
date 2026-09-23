import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlayoffBracketGameSummaryDto } from './series-game-slot.dto';

export class OpenPlayoffMatchTeamDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) logoUrl: string | null;
}

export const PLAYOFF_SERIES_FORMATS = ['bo1', 'bo3', 'bo5'] as const;
export type PlayoffSeriesFormat = (typeof PLAYOFF_SERIES_FORMATS)[number];

/**
 * One bracket slot grouping (a regular round is a series of bestOf 1). Finals
 * slots are flagged by `seriesKind`; their series length comes from the
 * tournament's finals settings and is reported in `format`.
 */
export class OpenPlayoffMatchDto {
  @ApiProperty() challongeMatchId: number;
  @ApiProperty() round: number;
  @ApiProperty() state: string;
  @ApiProperty({ type: OpenPlayoffMatchTeamDto })
  teamA: OpenPlayoffMatchTeamDto;
  @ApiProperty({ type: OpenPlayoffMatchTeamDto })
  teamB: OpenPlayoffMatchTeamDto;

  @ApiProperty({ description: 'Core identifier for persisted series envelope' })
  seriesId: string;

  @ApiProperty({
    enum: PLAYOFF_SERIES_FORMATS,
    description:
      'Series length of this slot. Regular rounds are always `bo1`; finals ' +
      'slots carry the length configured on the tournament (`bo1` / `bo3` / `bo5`).',
  })
  format: PlayoffSeriesFormat;

  @ApiProperty({
    enum: ['standard', 'finals'],
    description:
      '`finals` — one of the finals slots (upper-bracket final, lower-bracket ' +
      'final or grand final), whatever its `format`.',
  })
  seriesKind: 'standard' | 'finals';

  @ApiPropertyOptional({
    nullable: true,
    enum: ['upper_bracket_final', 'lower_bracket_final', 'grand_final'],
    description:
      'Which finals slot this is (only when `seriesKind` is `finals`). Otherwise null.',
  })
  finalSeriesType:
    | 'upper_bracket_final'
    | 'lower_bracket_final'
    | 'grand_final'
    | null;

  @ApiProperty() winsTeamA: number;
  @ApiProperty() winsTeamB: number;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Set once the series is mathematically locked.',
  })
  seriesWinnerTeamId: string | null;

  @ApiProperty() seriesResolved: boolean;

  /** Individual games persisted for this Challonge bracket node. */
  @ApiProperty({ type: [PlayoffBracketGameSummaryDto] })
  games: PlayoffBracketGameSummaryDto[];
}
