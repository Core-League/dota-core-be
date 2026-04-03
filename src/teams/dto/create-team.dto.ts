import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTeamDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'UUID of the captain player' })
  captainId: string;

  @ApiPropertyOptional({ description: 'UUID of the coach player' })
  coachId?: string;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty()
  isPlayingTournament: boolean;
}
