import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class CreateInviteDto {
  @ApiProperty({ enum: ['main', 'reserved', 'coach'] })
  @IsIn(['main', 'reserved', 'coach'])
  slot: 'main' | 'reserved' | 'coach';
}
