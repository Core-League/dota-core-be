import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ManualPlayoffSeriesGameDto {
  @ApiProperty({
    description: 'Challonge bracket node id this game belongs to.',
  })
  @IsString()
  @MaxLength(64)
  challongeMatchId: string;

  @ApiProperty({
    description: 'Winning Core team UUID (must appear in this bracket slot)',
  })
  @IsUUID()
  winnerTeamId: string;

  @ApiPropertyOptional({
    description:
      'Optional OpenDota match id — when omitted an internal synthetic id is used.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  dotaMatchId?: string;

  @ApiPropertyOptional({
    description:
      'Для BO3: номер підігри (gameNumber у Core, 1..3). Якщо не вказано — береться найменший підігровий слот без переможця.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  seriesGameSlot?: number;
}
