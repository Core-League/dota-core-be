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
import { SocialChannel } from './analytics.model';
import { AnalyticsService } from './analytics.service';
import {
  AnalyticsOverviewDto,
  SocialChannelStatDto,
} from './dto/analytics-overview.dto';
import { UpdateSocialFollowersDto } from './dto/update-social-followers.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Admin analytics overview',
    description:
      'Aggregated dashboard data: social followers (live where a platform API is configured, ' +
      'otherwise the admin-entered value), totals, rank distribution, team verification split, ' +
      'tournament participants, wantToPlay breakdown and player cities. Live follower counts ' +
      'are cached for 10 minutes.',
  })
  @ApiOkResponse({ type: AnalyticsOverviewDto })
  getOverview(): Promise<AnalyticsOverviewDto> {
    return this.analytics.getOverview();
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
