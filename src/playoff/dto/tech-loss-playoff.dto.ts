import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class TechLossPlayoffDto {
  @ApiProperty({
    description: 'UUID of the team that receives the technical win',
  })
  @IsUUID()
  winnerTeamId: string;

  @ApiProperty({
    description: 'UUID of the team that receives the technical loss',
  })
  @IsUUID()
  loserTeamId: string;
}
