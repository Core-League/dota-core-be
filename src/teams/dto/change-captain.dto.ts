import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ChangeCaptainDto {
  @ApiProperty({ description: 'UUID of the player to become new captain' })
  @IsUUID()
  newCaptainPlayerId: string;
}
