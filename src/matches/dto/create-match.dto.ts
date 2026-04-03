import { ApiProperty } from '@nestjs/swagger';

export class CreateMatchDto {
  @ApiProperty({ description: 'UUID of team A' })
  teamAId: string;

  @ApiProperty({ description: 'UUID of team B' })
  teamBId: string;

  @ApiProperty({ description: 'UUID of the winning team' })
  winnerId: string;

  @ApiProperty()
  dotaMatchId: string;
}
