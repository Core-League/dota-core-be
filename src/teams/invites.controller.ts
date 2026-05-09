import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithJwtActor } from '../auth/guards/own-player-or-admin.guard';
import { TeamsService } from './teams.service';

@ApiTags('invites')
@Controller('invites')
export class InvitesController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get(':token')
  getInviteInfo(@Param('token') token: string) {
    return this.teamsService.getInviteInfo(token);
  }

  @Post(':token/accept')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async acceptInvite(
    @Param('token') token: string,
    @Req() req: RequestWithJwtActor,
  ): Promise<void> {
    await this.teamsService.acceptInvite(token, req.user!.playerId);
  }
}
