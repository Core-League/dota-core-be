import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTeamDto {
  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ description: 'UUID of the coach player' })
  coachId?: string;

  @ApiPropertyOptional({ description: 'Dota 2 team ID from the game API' })
  dotaTeamId?: string;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty()
  isPlayingTournament: boolean;
}
