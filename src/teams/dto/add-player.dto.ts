import { ApiProperty } from '@nestjs/swagger';

export class AddPlayerDto {
  @ApiProperty()
  playerId: string;

  @ApiProperty({ enum: ['main', 'reserved'] })
  slot: 'main' | 'reserved';
}
