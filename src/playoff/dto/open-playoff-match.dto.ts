import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlayoffBracketGameSummaryDto } from './series-game-slot.dto';

export class OpenPlayoffMatchTeamDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) logoUrl: string | null;
}

/** One bracket slot grouping (BO1 counts as series of bestOf 1); finals BO3 are visually distinct via `seriesKind`. */
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
      '`finals_bo3` denotes one of UB final / LB final / GF Challonge finals slots.',
  })
  seriesKind: 'standard' | 'finals_bo3';

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
