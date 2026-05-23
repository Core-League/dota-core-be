import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One map inside a playoff series slot (single game row in DB). */
export class PlayoffBracketGameSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() gameNumber: number;
  @ApiPropertyOptional({ type: String, nullable: true })
  winnerTeamId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) dotaMatchId:
    | string
    | null;
}
