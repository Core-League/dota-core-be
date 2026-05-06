import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class SearchTeamsDto {
  @ApiPropertyOptional({
    description:
      'When true, each team includes `tournaments`: array built from its linked tournament (0 or 1 item).',
  })
  @IsOptional()
  @IsBoolean()
  withTournaments?: boolean;
}
