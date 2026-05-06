import { ApiProperty } from '@nestjs/swagger';
import { IsNumberString } from 'class-validator';

export class SubmitMatchDto {
  @ApiProperty({ description: 'Dota2 numeric match ID from the played game' })
  @IsNumberString()
  dotaMatchId: string;
}
