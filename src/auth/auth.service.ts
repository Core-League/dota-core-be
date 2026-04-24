import { HttpService } from '@nestjs/axios';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { DeepPartial, Repository } from 'typeorm';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { Role } from '../user-roles/role.constants';
import { CurrentPlayerDto } from './dto/current-player.dto';
import { DiscordExchangeDto } from './dto/discord-exchange.dto';

const OAUTH_STATE_TYP = 'oauth-state';
const STEAM_LINK_TYP = 'steam-link';

type SteamPlayerSummariesResponse = {
  response: { players: { steamid: string }[] };
};

type DiscordTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

type DiscordUserResponse = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Player)
    private readonly playersRepo: Repository<Player>,
    @InjectRepository(UserRoles)
    private readonly rolesRepo: Repository<UserRoles>,
    private readonly jwt: JwtService,
    private readonly http: HttpService,
  ) {}

  onModuleInit(): void {
    for (const key of ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'] as const) {
      if (!process.env[key]?.trim()) {
        this.logger.warn(
          `Missing env ${key}: Discord auth will fail until set`,
        );
      }
    }
    if (
      !process.env['DISCORD_REDIRECT_URI']?.trim() &&
      process.env['DISCORD_FRONTEND_REDIRECT']?.trim()
    ) {
      this.logger.warn(
        'DISCORD_FRONTEND_REDIRECT is ignored for OAuth; set DISCORD_REDIRECT_URI to the same redirect URL listed in the Discord app (or remove DISCORD_FRONTEND_REDIRECT).',
      );
    }
    const discordUri = this.resolveDiscordRedirectUri();
    if (!discordUri) {
      this.logger.warn(
        'Missing DISCORD_REDIRECT_URI: Discord auth will fail until set',
      );
    } else if (!/^https?:\/\//i.test(discordUri)) {
      this.logger.warn(
        'DISCORD_REDIRECT_URI must include http:// or https:// and match the Discord Developer Portal exactly',
      );
    }
    if (!process.env['STEAM_CALLBACK_URI']?.trim()) {
      this.logger.warn(
        'Missing env STEAM_CALLBACK_URI: Steam linking will fail until set',
      );
    }
    if (!process.env['JWT_SECRET']?.trim()) {
      this.logger.warn('Missing env JWT_SECRET: all auth will fail until set');
    }
  }

  // ── Discord ──────────────────────────────────────────────────────────────

  /** Value must be identical to a redirect in the Discord application OAuth2 settings. */
  private resolveDiscordRedirectUri(): string {
    return process.env['DISCORD_REDIRECT_URI']?.trim() ?? '';
  }

  buildDiscordAuthorizeUrl(): { url: string } {
    const clientId = process.env.DISCORD_CLIENT_ID?.trim();
    const redirectUri = this.resolveDiscordRedirectUri();
    const scopes = (process.env.DISCORD_SCOPES ?? 'identify').trim();
    if (!clientId || !redirectUri) {
      throw new UnauthorizedException('Discord OAuth is not configured');
    }
    const state = this.jwt.sign(
      { typ: OAUTH_STATE_TYP, v: 1 },
      { expiresIn: 600 },
    );
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      state,
    });
    const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    return { url };
  }

  async exchangeDiscordCode(
    dto: DiscordExchangeDto,
  ): Promise<{ access_token: string; token_type: string; expires_in: number }> {
    this.verifyOAuthState(dto.state);
    const redirectUri = this.resolveDiscordRedirectUri();
    const clientId = process.env.DISCORD_CLIENT_ID?.trim();
    const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
    if (!redirectUri || !clientId || !clientSecret) {
      throw new UnauthorizedException('Discord OAuth is not configured');
    }
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: dto.code,
      redirect_uri: redirectUri,
    });
    let discordToken: DiscordTokenResponse;
    try {
      const res = await firstValueFrom(
        this.http.post<DiscordTokenResponse>(
          'https://discord.com/api/oauth2/token',
          tokenBody.toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          },
        ),
      );
      discordToken = res.data;
    } catch (e) {
      this.handleDiscordAxiosError(e, 'token exchange');
    }
    let discordUser: DiscordUserResponse;
    try {
      const res = await firstValueFrom(
        this.http.get<DiscordUserResponse>(
          'https://discord.com/api/users/@me',
          {
            headers: {
              Authorization: `${discordToken.token_type} ${discordToken.access_token}`,
            },
          },
        ),
      );
      discordUser = res.data;
    } catch (e) {
      this.handleDiscordAxiosError(e, 'user profile');
    }
    const player = await this.upsertPlayerFromDiscord(discordUser);
    return this.issueJwt(player.id);
  }

  // ── Steam OpenID ─────────────────────────────────────────────────────────

  buildSteamLinkUrl(playerId: string): { url: string } {
    const callbackUri = process.env.STEAM_CALLBACK_URI?.trim();
    if (!callbackUri) {
      throw new InternalServerErrorException('Steam OpenID is not configured');
    }
    const state = this.jwt.sign(
      { typ: STEAM_LINK_TYP, sub: playerId },
      { expiresIn: 600 },
    );
    const realm = new URL(callbackUri).origin;
    const returnTo = `${callbackUri}?state=${encodeURIComponent(state)}`;
    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo,
      'openid.realm': realm,
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
    return {
      url: `https://steamcommunity.com/openid/login?${params.toString()}`,
    };
  }

  async handleSteamCallback(query: Record<string, string>): Promise<void> {
    // Verify state JWT to identify which player is linking
    const { state, ...openidParams } = query;
    let playerId: string;
    try {
      const payload = this.jwt.verify<{ typ: string; sub: string }>(
        state ?? '',
      );
      if (payload.typ !== STEAM_LINK_TYP) throw new Error();
      playerId = payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired Steam link state');
    }

    if (openidParams['openid.mode'] !== 'id_res') {
      throw new UnauthorizedException(
        'Steam authentication was denied or cancelled',
      );
    }

    // Confirm the signature with Steam (check_authentication)
    const checkParams = new URLSearchParams(
      openidParams as Record<string, string>,
    );
    checkParams.set('openid.mode', 'check_authentication');
    let responseText: string;
    try {
      const res = await firstValueFrom(
        this.http.post<string>(
          'https://steamcommunity.com/openid/login',
          checkParams.toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            responseType: 'text',
          },
        ),
      );
      responseText = String(res.data);
    } catch {
      throw new UnauthorizedException('Steam OpenID validation request failed');
    }

    if (!responseText.includes('is_valid:true')) {
      throw new UnauthorizedException('Steam OpenID signature is invalid');
    }

    // Extract SteamID from the claimed_id URL (e.g. https://steamcommunity.com/openid/id/76561198xxxxxxxx)
    const claimedId = openidParams['openid.claimed_id'] ?? '';
    const match = claimedId.match(/\/openid\/id\/(\d+)$/);
    if (!match) {
      throw new UnauthorizedException(
        'Could not extract SteamID from claimed_id',
      );
    }
    const steamId = match[1];

    // Reject if steamId is already linked to a different player
    const conflict = await this.playersRepo.findOne({ where: { steamId } });
    if (conflict && conflict.id !== playerId) {
      throw new ConflictException(
        'This Steam account is already linked to another player',
      );
    }

    const player = await this.playersRepo.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Player not found');
    player.steamId = steamId;
    await this.playersRepo.save(player);
  }

  async unlinkSteam(playerId: string): Promise<void> {
    const player = await this.playersRepo.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Player not found');
    player.steamId = null;
    await this.playersRepo.save(player);
  }

  /** Calls Steam API to confirm the linked account still exists.
   *  Clears steamId if the account is gone or the API key is not configured. */
  async verifySteamAccount(playerId: string): Promise<{ valid: boolean }> {
    const player = await this.playersRepo.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Player not found');
    if (!player.steamId) return { valid: false };

    const apiKey = process.env.STEAM_API_KEY?.trim();
    if (!apiKey) {
      throw new InternalServerErrorException(
        'STEAM_API_KEY is not configured — cannot verify Steam account',
      );
    }

    let found = false;
    try {
      const res = await firstValueFrom(
        this.http.get<SteamPlayerSummariesResponse>(
          'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/',
          { params: { key: apiKey, steamids: player.steamId } },
        ),
      );
      found = (res.data?.response?.players?.length ?? 0) > 0;
    } catch {
      throw new InternalServerErrorException('Steam API request failed');
    }

    if (!found) {
      player.steamId = null;
      await this.playersRepo.save(player);
    }
    return { valid: found };
  }

  // ── Shared ───────────────────────────────────────────────────────────────

  async getCurrentPlayer(playerId: string): Promise<CurrentPlayerDto> {
    const player = await this.playersRepo.findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    if (!player) {
      throw new NotFoundException('Player not found');
    }
    return {
      id: player.id,
      steamId: player.steamId ?? null,
      discordId: player.discordId ?? null,
      telegramId: player.telegramId ?? null,
      avatarUrl: player.avatarUrl ?? null,
      discordName: player.discordName ?? null,
      discordUsername: player.discordUsername ?? null,
      rating: player.rating,
      verifiedAt: player.verifiedAt ?? null,
      roles: (player.roles ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        isAdminRole: r.isAdminRole,
      })),
    };
  }

  private issueJwt(playerId: string): {
    access_token: string;
    token_type: string;
    expires_in: number;
  } {
    const ttlSec = process.env.JWT_EXPIRES_SEC
      ? Number(process.env.JWT_EXPIRES_SEC)
      : 60 * 60 * 24 * 7;
    const access_token = this.jwt.sign(
      { sub: playerId },
      { expiresIn: ttlSec },
    );
    const decoded = this.jwt.decode<{ exp: number }>(access_token);
    const expires_in =
      decoded?.exp !== undefined
        ? Math.max(0, decoded.exp - Math.floor(Date.now() / 1000))
        : 0;
    return { access_token, token_type: 'Bearer', expires_in };
  }

  private verifyOAuthState(state: string): void {
    try {
      const payload = this.jwt.verify<{ typ: string }>(state);
      if (payload.typ !== OAUTH_STATE_TYP) {
        throw new UnauthorizedException('Invalid OAuth state');
      }
    } catch {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }
  }

  private async upsertPlayerFromDiscord(
    discordUser: DiscordUserResponse,
  ): Promise<Player> {
    const discordId = discordUser.id;
    const discordName = discordUser.global_name?.trim() || discordUser.username;
    const discordUsername = discordUser.username;
    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.webp`
      : null;
    const existing = await this.playersRepo.findOne({ where: { discordId } });
    let player: Player;
    if (!existing) {
      player = this.playersRepo.create({
        discordId,
        discordName,
        discordUsername,
        avatarUrl,
        steamId: null,
        telegramId: null,
        rating: 0,
      } as DeepPartial<Player>);
    } else {
      existing.discordName = discordName;
      existing.discordUsername = discordUsername;
      existing.avatarUrl = avatarUrl;
      player = existing;
    }
    const saved = await this.playersRepo.save(player);
    if (!existing) {
      const role = this.rolesRepo.create({
        name: Role.GUEST,
        isAdminRole: false,
      } as DeepPartial<UserRoles>);
      role.player = saved;
      await this.rolesRepo.save(role);
    }
    return saved;
  }

  private handleDiscordAxiosError(e: unknown, step: string): never {
    if (e instanceof AxiosError && e.response?.data) {
      this.logger.warn(
        `Discord ${step} failed: ${JSON.stringify(e.response.data)}`,
      );
    } else if (e instanceof Error) {
      this.logger.warn(`Discord ${step} failed: ${e.message}`);
    }
    throw new UnauthorizedException('Discord authentication failed');
  }
}
