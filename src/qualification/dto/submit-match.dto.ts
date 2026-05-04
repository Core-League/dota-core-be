import { ApiProperty } from '@nestjs/swagger';

export class SubmitMatchDto {
  @ApiProperty({ description: 'Dota2 match ID from the played game' })
  dotaMatchId: string;
}
