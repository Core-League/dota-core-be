import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { AdminService, VerifyResult } from './admin.service';
import { AdminSetPlayerRolesDto } from './dto/admin-set-player-roles.dto';
import { AdminPlayerRolesResultDto } from './dto/admin-player-roles-result.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Patch('players/:playerId/admin')
  @ApiOkResponse({ type: AdminPlayerRolesResultDto })
  @ApiOperation({
    summary: 'Встановити повний набір ролей гравця',
    description:
      'Замінює записи user_roles для гравця (наприклад «Гравець» + «Капітан» + «Адмін»). Оновлює verifiedAt і синхронізує ролі в Discord за змінними DISCORD_*.',
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
