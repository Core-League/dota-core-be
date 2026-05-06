import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitMatchDto {
  @ApiProperty({ description: 'Dota2 match ID from the played game' })
  @IsString()
  @IsNotEmpty()
  dotaMatchId: string;
}
