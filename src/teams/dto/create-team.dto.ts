import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTeamDto {
  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ description: 'UUID of the coach player' })
  coachId?: string;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty()
  isPlayingTournament: boolean;
}
