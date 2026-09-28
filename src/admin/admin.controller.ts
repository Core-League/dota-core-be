import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import {
  AdminRoleResult,
  AdminService,
  DiscordSyncResult,
  PlayerRoleResult,
  VerifyResult,
} from './admin.service';
import { DueloService } from '../duelo/duelo.service';
import { Dota2Service } from '../dota2/dota2.service';
import { DotaLeagueAccessDto } from './dto/dota-league-access.dto';
import { SetPlayerRoleDto } from './dto/set-player-role.dto';
import { AdminSetPlayerRolesDto } from './dto/admin-set-player-roles.dto';
import { AdminPlayerRolesResultDto } from './dto/admin-player-roles-result.dto';
import { OverrideMatchResultDto } from './dto/override-match-result.dto';
import { MatchParticipantsService } from '../match-participants/match-participants.service';
import { BackfillMatchParticipantsReportDto } from '../match-participants/dto/backfill-match-participants.dto';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly dueloService: DueloService,
    private readonly dota2: Dota2Service,
    private readonly matchParticipants: MatchParticipantsService,
  ) {}

  @Post('match-participants/backfill')
  @ApiOperation({
    summary: 'Backfill who played each recorded map from OpenDota',
    description:
      'Idempotent and resumable. Walks finished qualification / playoff maps that have no participant ' +
      'rows yet, oldest Dota match first, at ~1 request/s to respect the OpenDota limit. Repeat with the ' +
      'returned lastDotaMatchId as afterDotaMatchId until remaining is 0. Failures are listed and skipped, ' +
      'so one unparsed match cannot block the rest. Feeds GET /players/:id/match-stats.',
  })
  @ApiQuery({ name: 'limit', required: false, description: '1–40, default 20' })
  @ApiQuery({ name: 'afterDotaMatchId', required: false })
  @ApiOkResponse({ type: BackfillMatchParticipantsReportDto })
  backfillMatchParticipants(
    @Query('limit') limit?: string,
    @Query('afterDotaMatchId') afterDotaMatchId?: string,
  ): Promise<BackfillMatchParticipantsReportDto> {
    const parsed = Number(limit);
    return this.matchParticipants.backfill({
      limit: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
      afterDotaMatchId: afterDotaMatchId ?? null,
    });
  }

  @Get('dota/leagues/:leagueId/access')
  @ApiOperation({
    summary: 'Diagnose the Dota 2 session against a league (read-only)',
    description:
      'Opens the league tournament admin page with the configured DOTA_* cookies and reports what ' +
      'Valve served, next to the public league record. Call it for a league that used to work and ' +
      'for the failing one: both failing means the cookies are dead; only the new one failing means ' +
      'the logged-in Steam account has no rights on that league. Creates nothing.',
  })
  @ApiParam({ name: 'leagueId', type: Number, example: 20246 })
  @ApiOkResponse({ type: DotaLeagueAccessDto })
  async dotaLeagueAccess(
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ): Promise<DotaLeagueAccessDto> {
    const probe = await this.dota2.probeLeagueAccess(leagueId);
    const league = probe.publicLeague;

    let verdict: string;
    if (!probe.sessionConfigured) {
      verdict =
        'DOTA_SESSION_ID / DOTA_OAUTH_TOKEN are not set — no page probe was made.';
    } else if (!league) {
      verdict = `Valve has no league with id ${leagueId}; check the id.`;
    } else if (probe.adminPageReached) {
      verdict = `The session is recognised on league ${leagueId}${
        probe.loggedInAs ? ` as "${probe.loggedInAs}"` : ''
      }; tournament groups can be created here.`;
    } else if (probe.loginLinkPresent) {
      verdict =
        'Valve does not treat this session as logged in at all: the cookies are expired or ' +
        'come from different logins. Log in to dota2.com once and copy dota_oauth_token, ' +
        'dota_oauth_info and sessionid from that same session.';
    } else {
      verdict =
        `The session is logged in but got the public page for league ${leagueId}: the ` +
        'logged-in Steam account has no admin rights on this league. Add that account ' +
        '(not necessarily yours) to the league admins on dota2.com.';
    }

    return {
      leagueId,
      sessionConfigured: probe.sessionConfigured,
      publicName: league?.name ?? null,
      publicStatus: league?.status ?? null,
      publicNodeGroups: league?.nodeGroupIds.length ?? 0,
      adminPageReached: probe.adminPageReached,
      pageTitle: probe.pageTitle,
      loginLinkPresent: probe.loginLinkPresent,
      loggedInAs: probe.loggedInAs,
      organizationalGroupsOnPage: probe.organizationalGroupsOnPage,
      verdict,
    };
  }

  @Post('matches/:matchId/result')
  @ApiOperation({
    summary: 'Manually set match result (bypasses OpenDota verification)',
    description:
      'Sets the winner directly and awards points. winnerPoints defaults to 100, loserPoints to 40. Throws 409 if the match already has a result.',
  })
  @ApiParam({ name: 'matchId', type: String, format: 'uuid' })
  overrideMatchResult(
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() body: OverrideMatchResultDto,
  ): Promise<{ matchId: string; winnerId: string }> {
    return this.adminService.overrideMatchResult(matchId, body);
  }

  @Post('playoff-matches/:matchId/result')
  @ApiOperation({
    summary: 'Override a playoff game result',
    description:
      'Changes the winner of an individual playoff game and resets isVerified to false.',
  })
  @ApiParam({ name: 'matchId', type: String, format: 'uuid' })
  overridePlayoffMatchResult(
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() body: OverrideMatchResultDto,
  ): Promise<{ matchId: string; winnerId: string }> {
    return this.adminService.overridePlayoffMatchResult(matchId, body);
  }

  @Post('discord/sync')
  @ApiOperation({
    summary: 'Sync Discord roles and voice channels for all verified teams',
    description:
      'Idempotent: creates missing roles/channels and re-syncs all member roles. Safe to run multiple times.',
  })
  syncDiscord(): Promise<DiscordSyncResult> {
    return this.adminService.syncDiscord();
  }

  @Delete('teams/:teamId/verify')
  @ApiOperation({
    summary: 'Remove team verification',
    description:
      'Sets isVerified=false and clears verifiedAt. Does not remove Discord role/channel.',
  })
  @ApiParam({ name: 'teamId', type: String, format: 'uuid' })
  unverifyTeam(
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ): Promise<{ teamId: string; isVerified: boolean }> {
    return this.adminService.unverifyTeam(teamId);
  }

  @Patch('players/:playerId/roles')
  @ApiOkResponse({ type: AdminPlayerRolesResultDto })
  @ApiOperation({
    summary: 'Встановити повний набір ролей гравця',
    description:
      'Замінює записи user_roles. Оновлює verifiedAt і синхронізує ролі в Discord (DISCORD_*). Шлях відрізняється від POST/DELETE …/admin (grant/revoke admin).',
  })
  @ApiParam({ name: 'playerId', type: String, format: 'uuid' })
  setPlayerRoles(
    @Param('playerId', ParseUUIDPipe) playerId: string,
    @Body() body: AdminSetPlayerRolesDto,
  ): Promise<AdminPlayerRolesResultDto> {
    return this.adminService.setPlayerRoles(playerId, body);
  }

  @Post('players/:playerId/verify')
  @ApiOperation({
    summary: 'Verify a player',
    description:
      "Sets the player's primary role to «Гравець» and stamps verifiedAt. Requires admin role.",
  })
  @ApiParam({ name: 'playerId', type: String, format: 'uuid' })
  verifyPlayer(
    @Param('playerId', ParseUUIDPipe) playerId: string,
  ): Promise<VerifyResult> {
    return this.adminService.verifyPlayer(playerId);
  }

  @Delete('players/:playerId/verify')
  @ApiOperation({
    summary: 'Unverify a player',
    description:
      "Reverts the player's primary role to «Гість» and clears verifiedAt. Requires admin role.",
  })
  @ApiParam({ name: 'playerId', type: String, format: 'uuid' })
  unverifyPlayer(
    @Param('playerId', ParseUUIDPipe) playerId: string,
  ): Promise<VerifyResult> {
    return this.adminService.unverifyPlayer(playerId);
  }

  @Put('players/:playerId/role')
  @ApiOperation({
    summary: "Set player's primary role (Гість/Гравець/Медіа)",
    description:
      'Replaces the primary (non-admin) tier row. Гравець stamps verifiedAt; Гість clears verifiedAt; Медіа leaves verifiedAt unchanged. Адмін — POST/DELETE …/admin. Капітан — команди.',
  })
  @ApiParam({ name: 'playerId', type: String, format: 'uuid' })
  setPlayerRole(
    @Param('playerId', ParseUUIDPipe) playerId: string,
    @Body() body: SetPlayerRoleDto,
  ): Promise<PlayerRoleResult> {
    return this.adminService.setPlayerRole(playerId, body.name);
  }

  @Post('players/:playerId/admin')
  @ApiOperation({
    summary: 'Grant admin role to a player',
    description:
      'Idempotently adds an admin role row; primary role and verifiedAt preserved.',
  })
  @ApiParam({ name: 'playerId', type: String, format: 'uuid' })
  grantAdmin(
    @Param('playerId', ParseUUIDPipe) playerId: string,
  ): Promise<AdminRoleResult> {
    return this.adminService.grantAdmin(playerId);
  }

  @Delete('players/:playerId/admin')
  @ApiOperation({
    summary: 'Revoke admin role from a player',
    description:
      'Removes admin role rows. Acting admin cannot revoke own admin (403).',
  })
  @ApiParam({ name: 'playerId', type: String, format: 'uuid' })
  revokeAdmin(
    @Req() req: AuthedRequest,
    @Param('playerId', ParseUUIDPipe) playerId: string,
  ): Promise<AdminRoleResult> {
    return this.adminService.revokeAdmin(playerId, req.user.playerId);
  }

  @Post('sync-partner-matches')
  @ApiOperation({
    summary: 'Sync all historical matches to Duelo.gg partner webhook',
    description:
      'Re-fetches every verified qualification match from OpenDota and sends it to the Duelo.gg webhook. Returns counts of sent and errored matches.',
  })
  syncPartnerMatches(): Promise<{ sent: number; errors: number }> {
    return this.dueloService.syncAllMatches();
  }
}
