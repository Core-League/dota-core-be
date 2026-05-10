import { ApiProperty } from '@nestjs/swagger';
import { Qualification } from '../qualification.entity';

class PlayerPointsEntry {
  @ApiProperty()
  playerId: string;

  @ApiProperty()
  points: number;
}

export class QualificationResponseDto extends Qualification {
  @ApiProperty({ type: [PlayerPointsEntry] })
  playerTournamentPoints: PlayerPointsEntry[];
}
