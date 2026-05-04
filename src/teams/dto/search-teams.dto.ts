import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchTeamsDto {
  @ApiPropertyOptional({
    description:
      'When true, each team includes `tournaments`: array built from its linked tournament (0 or 1 item).',
  })
  withTournaments?: boolean;
}
