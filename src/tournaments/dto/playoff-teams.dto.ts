import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID } from 'class-validator';

/** For `POST …/playoff/start`, omit teamIds or pass [] to use only teams already staged in `tournament_playoff_team`. */
export class PlayoffTeamsDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: ['uuid-1', 'uuid-2'],
    description:
      'When omitted or empty with `POST …/playoff/start`, seeded teams come from playoff staging only.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  teamIds?: string[];
}
