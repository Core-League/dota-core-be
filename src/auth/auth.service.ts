import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { DeepPartial, Repository } from 'typeorm';
import { Player } from '../players/player.entity';
import { DiscordExchangeDto } from './dto/discord-exchange.dto';

const OAUTH_STATE_TYP = 'oauth-state';

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
    private readonly jwt: JwtService,
    private readonly http: HttpService,
  ) {}

  onModuleInit(): void {
    const required = [
      'DISCORD_CLIENT_ID',
      'DISCORD_CLIENT_SECRET',
      'DISCORD_REDIRECT_URI',
      'JWT_SECRET',
    ] as const;
    for (const key of required) {
      if (!process.env[key]?.trim()) {
        this.logger.warn(
          `Missing env ${key}: Discord auth will fail until set`,
        );
      }
    }
    const uri = process.env.DISCORD_REDIRECT_URI?.trim() ?? '';
    if (uri && !/^https?:\/\//i.test(uri)) {
      this.logger.warn(
        'DISCORD_REDIRECT_URI must include http:// or https:// and match the Discord Developer Portal exactly',
      );
    }
  }

  buildDiscordAuthorizeUrl(): { url: string } {
    const clientId = process.env.DISCORD_CLIENT_ID?.trim();
    const redirectUri = process.env.DISCORD_REDIRECT_URI?.trim();
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
    const redirectUri = process.env.DISCORD_REDIRECT_URI?.trim();
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
    const ttlSec = process.env.JWT_EXPIRES_SEC
      ? Number(process.env.JWT_EXPIRES_SEC)
      : 60 * 60 * 24 * 7;
    const access_token = this.jwt.sign(
      { sub: player.id },
      { expiresIn: ttlSec },
    );
    const decoded = this.jwt.decode<{ exp: number }>(access_token);
    const expires_in =
      decoded?.exp !== undefined
        ? Math.max(0, decoded.exp - Math.floor(Date.now() / 1000))
        : 0;
    return {
      access_token,
      token_type: 'Bearer',
      expires_in,
    };
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
    let player = await this.playersRepo.findOne({ where: { discordId } });
    if (!player) {
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
      player.discordName = discordName;
      player.discordUsername = discordUsername;
      player.avatarUrl = avatarUrl;
    }
    return this.playersRepo.save(player);
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
