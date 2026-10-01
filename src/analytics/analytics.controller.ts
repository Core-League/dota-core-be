import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../admin/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAchievementsDto } from '../players/dto/player-achievements.dto';
import { PlayerAchievementsService } from '../players/player-achievements.service';
import { SocialChannel } from './analytics.model';
import { AnalyticsInsightsService } from './analytics-insights.service';
import { AnalyticsService } from './analytics.service';
import {
  AnalyticsOverviewDto,
  SocialChannelStatDto,
} from './dto/analytics-overview.dto';
import { AnalyticsInsightsDto } from './dto/analytics-insights.dto';
import { UpdateSocialFollowersDto } from './dto/update-social-followers.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly achievements: PlayerAchievementsService,
    private readonly insights: AnalyticsInsightsService,
  ) {}

  @Get('achievements')
  @ApiOperation({
    summary: 'Platform trophy board',
    description:
      'Every achievement kind the platform awards with the players holding it, best holder first. ' +
      'Kinds nobody has earned yet come back with an empty holder list. Same crediting rules as ' +
      'GET /players/:id/achievements.',
  })
  @ApiOkResponse({ type: PlatformAchievementsDto })
  getAchievements(): Promise<PlatformAchievementsDto> {
    return this.achievements.getPlatform();
  }

  @Get('overview')
  @ApiOperation({
    summary: 'Admin analytics overview',
    description:
      'Aggregated dashboard data: social followers (live where a platform API is configured, ' +
      'otherwise the admin-entered value), totals, rank distribution, team verification split, ' +
      'tournament participants, wantToPlay breakdown, player cities and the 1v1 ladder ' +
      '(duel counts by outcome, duels in progress, queue length, host-bot pool). Live follower ' +
      'counts are cached for 10 minutes.',
  })
  @ApiOkResponse({ type: AnalyticsOverviewDto })
  getOverview(): Promise<AnalyticsOverviewDto> {
    return this.analytics.getOverview();
  }

  @Get('insights')
  @ApiOperation({
    summary: 'Admin analytics insights',
    description:
      'Secondary dashboard numbers: recruiting pool (players in a team vs free agents, linked ' +
      'accounts, positions 1–5 with free agents per position), settled revenue in kopecks ' +
      '(VIP, entry fees, donations — all-time, last 30 days, last 6 months), VIP subscribers ' +
      'and 1v1 duel activity per day over the last 30 days. Days and months are Europe/Kyiv.',
  })
  @ApiOkResponse({ type: AnalyticsInsightsDto })
  getInsights(): Promise<AnalyticsInsightsDto> {
    return this.insights.getInsights();
  }

  @Put('socials/:channel')
  @ApiOperation({
    summary: 'Set the manual follower count of a social channel',
    description:
      'Stored value used when no live source is configured for the channel (Instagram, TikTok). ' +
      'A live count, when available, still takes precedence. Pass `followers: null` to clear.',
  })
  @ApiParam({ name: 'channel', enum: SocialChannel })
  @ApiOkResponse({ type: SocialChannelStatDto })
  setSocialFollowers(
    @Param('channel', new ParseEnumPipe(SocialChannel)) channel: SocialChannel,
    @Body() body: UpdateSocialFollowersDto,
  ): Promise<SocialChannelStatDto> {
    return this.analytics.setManualFollowers(channel, body.followers);
  }
}
