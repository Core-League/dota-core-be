import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

export class AddPlayerDto {
  @ApiProperty()
  @IsUUID()
  playerId: string;

  @ApiProperty({ enum: ['main', 'reserved'] })
  @IsIn(['main', 'reserved'])
  slot: 'main' | 'reserved';
}
