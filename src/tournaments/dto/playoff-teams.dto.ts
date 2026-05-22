import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class PlayoffTeamsDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: ['uuid-1', 'uuid-2'],
  })
  @IsArray()
  @IsUUID('all', { each: true })
  teamIds: string[];
}
