import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateMatchDto {
  @ApiProperty({ description: 'UUID of team A' })
  @IsUUID()
  teamAId: string;

  @ApiProperty({ description: 'UUID of team B' })
  @IsUUID()
  teamBId: string;

  @ApiProperty({ description: 'UUID of the winning team' })
  @IsUUID()
  winnerId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dotaMatchId: string;
}
