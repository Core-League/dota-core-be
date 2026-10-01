import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminGuard } from '../admin/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AdminGrantVipDto,
  AdminVipResultDto,
  UpdateVipFrameColorDto,
  VipCheckoutDto,
  VipStatusDto,
} from './dto/vip.dto';
import { VipService } from './vip.service';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('vip')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vip')
export class VipController {
  constructor(private readonly vip: VipService) {}

  @Get('me')
  @ApiOperation({ summary: 'My VIP status, price, palette and auto-renewal' })
  @ApiOkResponse({ type: VipStatusDto })
  me(@Req() req: AuthedRequest): Promise<VipStatusDto> {
    return this.vip.getStatus(req.user.playerId);
  }

  @Post('checkout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create the first VIP invoice (200 ₴) with card tokenization',
    description:
      'Returns the Monobank payment page. The card is saved and charged monthly until auto-renewal ' +
      'is cancelled. 409 while auto-renewal is already on.',
  })
  @ApiOkResponse({ type: VipCheckoutDto })
  checkout(@Req() req: AuthedRequest): Promise<VipCheckoutDto> {
    return this.vip.checkout(req.user.playerId, req.headers);
  }

  @Post('cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Turn auto-renewal off; VIP lasts until the paid period ends',
  })
  @ApiOkResponse({ type: VipStatusDto })
  cancel(@Req() req: AuthedRequest): Promise<VipStatusDto> {
    return this.vip.cancelAutoRenew(req.user.playerId);
  }

  @Post('resume')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Turn auto-renewal back on with the saved card (VIP must still last)',
  })
  @ApiOkResponse({ type: VipStatusDto })
  resume(@Req() req: AuthedRequest): Promise<VipStatusDto> {
    return this.vip.resumeAutoRenew(req.user.playerId);
  }

  @Patch('frame-color')
  @ApiOperation({
    summary: 'Pick the card frame colour (VIP only)',
    description:
      'Only colours from the VIP palette; role colours are reserved. null resets.',
  })
  @ApiOkResponse({ type: VipStatusDto })
  setFrameColor(
    @Req() req: AuthedRequest,
    @Body() body: UpdateVipFrameColorDto,
  ): Promise<VipStatusDto> {
    return this.vip.setFrameColor(req.user.playerId, body.color);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/players')
export class VipAdminController {
  constructor(private readonly vip: VipService) {}

  @Post(':id/vip')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Grant VIP without payment',
    description:
      'Adds the given months on top of the current VIP period (or from now), or `lifetime: true` ' +
      'for VIP that never expires (auto-renewal switched off).',
  })
  @ApiOkResponse({ type: AdminVipResultDto })
  grant(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminGrantVipDto,
  ): Promise<AdminVipResultDto> {
    return this.vip.adminGrant(id, body, req.user.playerId);
  }

  @Delete(':id/vip')
  @ApiOperation({
    summary: 'Revoke VIP now',
    description: 'Ends VIP immediately and switches auto-renewal off.',
  })
  @ApiOkResponse({ type: AdminVipResultDto })
  revoke(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminVipResultDto> {
    return this.vip.adminRevoke(id, req.user.playerId);
  }

  @Patch(':id/vip/frame-color')
  @ApiOperation({
    summary: "Set a VIP player's card frame colour",
    description:
      'Same palette and rules as the player picker (VIP only, role colours reserved). null resets.',
  })
  @ApiOkResponse({ type: AdminVipResultDto })
  setFrameColor(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateVipFrameColorDto,
  ): Promise<AdminVipResultDto> {
    return this.vip.adminSetFrameColor(id, body.color, req.user.playerId);
  }
}
