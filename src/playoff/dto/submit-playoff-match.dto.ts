import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class SubmitPlayoffMatchDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dotaMatchId: string;
}
