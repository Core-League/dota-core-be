import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentPlayerDto } from './dto/current-player.dto';
import { DiscordExchangeDto } from './dto/discord-exchange.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── Discord ───────────────────────────────────────────────────────────

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

  // ── Steam OpenID ─────────────────────────────────────────────────────────

  @Get('steam/link')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Steam OpenID link URL',
    description:
      'Returns a URL to redirect the authenticated user to for Steam account linking. No Valve partnership required — uses public Steam OpenID. After the user approves, Steam GET-redirects to STEAM_CALLBACK_URI where the account is linked server-side.',
  })
  getSteamLinkUrl(@Req() req: AuthedRequest): { url: string } {
    return this.authService.buildSteamLinkUrl(req.user.playerId);
  }

  /** @deprecated */
  // TODO: remove
  // @Delete('steam/link')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  // @ApiOperation({
  //   summary: 'Unlink Steam account',
  //   description: 'Clears the steamId on the current player.',
  // })
  // unlinkSteam(@Req() req: AuthedRequest): Promise<void> {
  //   return this.authService.unlinkSteam(req.user.playerId);
  // }

  @Post('steam/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify linked Steam account',
    description:
      'Calls the Steam API to confirm the linked account still exists. Clears steamId automatically if the account is gone. Requires STEAM_API_KEY env var.',
  })
  verifySteamAccount(@Req() req: AuthedRequest): Promise<{ valid: boolean }> {
    return this.authService.verifySteamAccount(req.user.playerId);
  }

  @Get('steam/callback')
  @ApiOperation({
    summary: 'Steam OpenID callback (server-side)',
    description:
      'Validates the Steam OpenID response, links the SteamID to the player, then redirects to STEAM_FRONTEND_REDIRECT.',
  })
  async steamCallback(
    @Req() req: Request,
    @Query() query: Record<string, string | string[] | undefined>,
    @Res() res: Response,
  ) {
    const frontendRedirect = process.env.STEAM_FRONTEND_REDIRECT ?? '/';
    try {
      await this.authService.handleSteamCallback(
        query,
        req.originalUrl ?? req.url,
      );
      return res.redirect(`${frontendRedirect}?steam_linked=true`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Steam link failed';
      return res.redirect(
        `${frontendRedirect}?steam_error=${encodeURIComponent(msg)}`,
      );
    }
  }

  // ── Shared ───────────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: CurrentPlayerDto })
  @ApiOperation({
    summary: 'Current player profile',
    description:
      'Returns the Player row for the JWT subject. Send Authorization: Bearer <access_token>.',
  })
  me(@Req() req: AuthedRequest): Promise<CurrentPlayerDto> {
    return this.authService.getCurrentPlayer(req.user.playerId);
  }
}
