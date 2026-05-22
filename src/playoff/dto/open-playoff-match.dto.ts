import { ApiProperty } from '@nestjs/swagger';

export class OpenPlayoffMatchTeamDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) logoUrl: string | null;
}

export class OpenPlayoffMatchDto {
  @ApiProperty() challongeMatchId: number;
  @ApiProperty() round: number;
  @ApiProperty() state: string;
  @ApiProperty({ type: OpenPlayoffMatchTeamDto })
  teamA: OpenPlayoffMatchTeamDto;
  @ApiProperty({ type: OpenPlayoffMatchTeamDto })
  teamB: OpenPlayoffMatchTeamDto;
}
