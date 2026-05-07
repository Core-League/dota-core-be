import {
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { AdminService, DiscordSyncResult, VerifyResult } from './admin.service';

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
}
