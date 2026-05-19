import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DisqualifyTeamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teamId: string;
}
