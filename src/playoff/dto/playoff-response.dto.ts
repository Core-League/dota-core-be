import { ApiProperty } from '@nestjs/swagger';
import { TeamResponseDto } from '../../teams/dto/team-response.dto';

export class PlayoffResponseDto {
  @ApiProperty()
  embedUrl: string;

  @ApiProperty({ type: [TeamResponseDto] })
  teams: TeamResponseDto[];
}
