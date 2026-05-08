import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
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
import { SetPlayerRoleDto } from './dto/set-player-role.dto';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('discord/sync')
  @ApiOperation({
    summary: 'Sync Discord roles and voice channels for all verified teams',
    description:
      'Idempotent: creates missing roles/channels and re-syncs all member roles. Safe to run multiple times.',
  })
  syncDiscord(): Promise<DiscordSyncResult> {
    return this.adminService.syncDiscord();
  }

  @Post('players/:playerId/verify')
  @ApiOperation({
    summary: 'Verify a player',
    description:
      "Sets the player's role to «Гравець» and stamps verifiedAt. Requires admin role.",
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
      "Reverts the player's role to «Гість» and clears verifiedAt. Requires admin role.",
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
      "Replaces the player's primary (non-admin) role row. Гравець stamps verifiedAt and adds the Discord verified role; Гість clears verifiedAt and removes it; Медіа leaves verifiedAt and Discord state untouched. Адмін is granted via POST /admin/players/:playerId/admin. Капітан is managed by team flows.",
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
      'Idempotently adds an admin role row for the player; the existing primary role and verifiedAt are preserved. Requires admin role.',
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
      'Removes all admin role rows for the player. The acting admin cannot revoke their own admin role (returns 403).',
  })
  @ApiParam({ name: 'playerId', type: String, format: 'uuid' })
  revokeAdmin(
    @Req() req: AuthedRequest,
    @Param('playerId', ParseUUIDPipe) playerId: string,
  ): Promise<AdminRoleResult> {
    return this.adminService.revokeAdmin(playerId, req.user.playerId);
  }
}
