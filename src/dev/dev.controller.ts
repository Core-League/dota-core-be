import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { DevMockMatchDto } from './dto/dev-mock-match.dto';
import { DevService } from './dev.service';

@Controller('dev')
export class DevController {
  constructor(private readonly devService: DevService) {}

  @Post('mock-match')
  mockMatch(@Body() dto: DevMockMatchDto) {
    if (process.env.NODE_ENV !== 'development') {
      throw new ForbiddenException(
        'This endpoint is only available in development mode',
      );
    }
    if (dto.phase === 'qualification') {
      return this.devService.mockQualificationMatch(
        dto.tournamentId,
        dto.teamAId,
        dto.teamBId,
      );
    }
    return this.devService.mockPlayoffMatch(
      dto.tournamentId,
      dto.teamAId,
      dto.teamBId,
    );
  }
}
