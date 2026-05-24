import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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
import { SetPlayerRoleDto } from './dto/set-player-role.dto';
import { AdminSetPlayerRolesDto } from './dto/admin-set-player-roles.dto';
import { AdminPlayerRolesResultDto } from './dto/admin-player-roles-result.dto';
import { OverrideMatchResultDto } from './dto/override-match-result.dto';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly dueloService: DueloService,
  ) {}

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
