import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { DiscordExchangeDto } from './dto/discord-exchange.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('discord/url')
  @ApiOperation({
    summary: 'Get Discord OAuth2 URL',
    description:
      'Redirect the browser to the returned URL. After login, Discord redirects to DISCORD_REDIRECT_URI with ?code=...&state=...; send those to POST /auth/discord/token.',
  })
  getDiscordAuthorizeUrl(): { url: string } {
    return this.authService.buildDiscordAuthorizeUrl();
  }

  @Post('discord/token')
  @ApiOperation({
    summary: 'Exchange Discord OAuth code for app JWT',
    description:
      'Body must include code and state exactly as returned by Discord on your redirect URI.',
  })
  exchangeDiscordToken(@Body() body: DiscordExchangeDto) {
    return this.authService.exchangeDiscordCode(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Current player id from JWT',
    description:
      'Send Authorization: Bearer <access_token> from POST /auth/discord/token.',
  })
  me(@Req() req: AuthedRequest): { playerId: string } {
    return { playerId: req.user.playerId };
  }
}
