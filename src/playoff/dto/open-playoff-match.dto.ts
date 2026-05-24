import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlayoffBracketGameSummaryDto } from './series-game-slot.dto';

export class OpenPlayoffMatchTeamDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) logoUrl: string | null;
}

/** One bracket slot grouping (BO1 counts as series of bestOf 1); finals BO3 групуються через `seriesKind`. */
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

  @ApiProperty({ enum: ['bo1', 'bo3'] }) format: 'bo1' | 'bo3';

  @ApiProperty({
    enum: ['standard', 'finals_bo3'],
    description:
      '`finals_bo3` — один із BO3-finals (верхній / нижній / grand final сітки).',
  })
  seriesKind: 'standard' | 'finals_bo3';

  @ApiPropertyOptional({
    nullable: true,
    enum: ['upper_bracket_final', 'lower_bracket_final', 'grand_final'],
    description:
      'Конкретний тип finals-серії (лише коли BO3-finals). Інакше null.',
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
