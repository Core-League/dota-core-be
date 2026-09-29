import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeaderboardDto } from './dto/leaderboard.dto';
import { LeaderboardService } from './leaderboard.service';

@ApiTags('leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  /** Public, like player profiles. */
  @Get()
  @ApiOperation({
    summary: 'Platform leaderboard',
    description:
      'Every player with at least one recorded map or achievement, ranked by a composite score of ' +
      'podium finishes, achievements, map record and qualification points. The `weights` object ' +
      'states what each statistic is worth. Rebuilt at most once a minute.',
  })
  @ApiOkResponse({ type: LeaderboardDto })
  getLeaderboard(): Promise<LeaderboardDto> {
    return this.leaderboard.getBoard();
  }
}
