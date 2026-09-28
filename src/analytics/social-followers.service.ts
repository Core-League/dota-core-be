import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { firstValueFrom } from 'rxjs';
import { SOCIAL_CHANNEL_CATALOG, SocialChannel } from './analytics.model';

export interface LiveFollowers {
  followers: number;
  fetchedAt: Date;
}

/**
 * Live follower counts, fetched straight from each platform and cached in
 * memory for {@link SocialFollowersService.TTL_MS}. Every fetcher is optional:
 * when its credentials are missing or the request fails it resolves to `null`
 * (keeping the last good value, if any) and the dashboard falls back to the
 * admin-entered number.
 *
 * - Discord: `GET /guilds/:id?with_counts=true` with the bot token when
 *   configured, otherwise the public invite endpoint (no auth needed).
 * - Telegram: Bot API `getChatMemberCount` when `TELEGRAM_BOT_TOKEN` is set,
 *   otherwise the public `t.me/<channel>` preview page.
 * - YouTube: Data API v3 `channels?forHandle=` — needs `YOUTUBE_API_KEY`.
 * - Twitch: Helix `channels/followers` — needs `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET`.
 * - Instagram / TikTok: no public counter API — manual only.
 */
@Injectable()
export class SocialFollowersService {
  static readonly TTL_MS = 10 * 60 * 1000;

  private readonly logger = new Logger(SocialFollowersService.name);
  private readonly cache = new Map<SocialChannel, LiveFollowers>();
  private twitchToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly http: HttpService) {}

  async getLive(channel: SocialChannel): Promise<LiveFollowers | null> {
    const cached = this.cache.get(channel);
    if (
      cached &&
      Date.now() - cached.fetchedAt.getTime() < SocialFollowersService.TTL_MS
    ) {
      return cached;
    }

    try {
      const followers = await this.fetch(channel);
      if (followers == null) return cached ?? null;
      const entry: LiveFollowers = { followers, fetchedAt: new Date() };
      this.cache.set(channel, entry);
      return entry;
    } catch (e) {
      this.logger.warn(
        `Live followers for ${channel} unavailable: ${this.errMsg(e)}`,
      );
      return cached ?? null;
    }
  }

  private fetch(channel: SocialChannel): Promise<number | null> {
    switch (channel) {
      case SocialChannel.DISCORD:
        return this.fetchDiscord();
      case SocialChannel.TELEGRAM:
        return this.fetchTelegram();
      case SocialChannel.YOUTUBE:
        return this.fetchYoutube();
      case SocialChannel.TWITCH:
        return this.fetchTwitch();
      default:
        return Promise.resolve(null);
    }
  }

  private async fetchDiscord(): Promise<number | null> {
    const token = process.env.DISCORD_BOT_TOKEN;
    const guildId = process.env.DISCORD_SYNC_GUILD_ID;
    if (token && guildId) {
      const res = await firstValueFrom(
        this.http.get<{ approximate_member_count?: number }>(
          `https://discord.com/api/v10/guilds/${guildId}?with_counts=true`,
          { headers: { Authorization: `Bot ${token}` } },
        ),
      );
      return this.toCount(res.data.approximate_member_count);
    }

    const invite = SOCIAL_CHANNEL_CATALOG[SocialChannel.DISCORD].handle;
    const res = await firstValueFrom(
      this.http.get<{ approximate_member_count?: number }>(
        `https://discord.com/api/v10/invites/${invite}?with_counts=true`,
      ),
    );
    return this.toCount(res.data.approximate_member_count);
  }

  private async fetchTelegram(): Promise<number | null> {
    const handle = SOCIAL_CHANNEL_CATALOG[SocialChannel.TELEGRAM].handle;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      const res = await firstValueFrom(
        this.http.get<{ ok: boolean; result?: number }>(
          `https://api.telegram.org/bot${token}/getChatMemberCount`,
          { params: { chat_id: `@${handle}` } },
        ),
      );
      return res.data.ok ? this.toCount(res.data.result) : null;
    }

    // Public preview page: <div class="tgme_page_extra">1 234 subscribers</div>
    const res = await firstValueFrom(
      this.http.get<string>(`https://t.me/${handle}`, {
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CoreLeagueBot/1.0)',
        },
      }),
    );
    const $ = cheerio.load(res.data);
    const text = $('.tgme_page_extra').first().text();
    // `\s` already covers the NBSP thousands separator Telegram uses.
    const match = /([\d\s,.]+)\s*(subscribers|members)/i.exec(text);
    if (!match) return null;
    return this.toCount(Number(match[1].replace(/\D/g, '')));
  }

  private async fetchYoutube(): Promise<number | null> {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) return null;
    const handle = SOCIAL_CHANNEL_CATALOG[SocialChannel.YOUTUBE].handle;
    const res = await firstValueFrom(
      this.http.get<{
        items?: { statistics?: { subscriberCount?: string } }[];
      }>('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'statistics', forHandle: `@${handle}`, key },
      }),
    );
    return this.toCount(res.data.items?.[0]?.statistics?.subscriberCount);
  }

  private async fetchTwitch(): Promise<number | null> {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const token = await this.getTwitchToken(clientId, clientSecret);
    const headers = { 'Client-Id': clientId, Authorization: `Bearer ${token}` };
    const login = SOCIAL_CHANNEL_CATALOG[SocialChannel.TWITCH].handle;

    const user = await firstValueFrom(
      this.http.get<{ data?: { id: string }[] }>(
        'https://api.twitch.tv/helix/users',
        { params: { login }, headers },
      ),
    );
    const broadcasterId = user.data.data?.[0]?.id;
    if (!broadcasterId) return null;

    const followers = await firstValueFrom(
      this.http.get<{ total?: number }>(
        'https://api.twitch.tv/helix/channels/followers',
        { params: { broadcaster_id: broadcasterId, first: 1 }, headers },
      ),
    );
    return this.toCount(followers.data.total);
  }

  private async getTwitchToken(
    clientId: string,
    clientSecret: string,
  ): Promise<string> {
    if (this.twitchToken && this.twitchToken.expiresAt > Date.now() + 60_000) {
      return this.twitchToken.value;
    }
    const res = await firstValueFrom(
      this.http.post<{ access_token: string; expires_in: number }>(
        'https://id.twitch.tv/oauth2/token',
        null,
        {
          params: {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
          },
        },
      ),
    );
    this.twitchToken = {
      value: res.data.access_token,
      expiresAt: Date.now() + res.data.expires_in * 1000,
    };
    return this.twitchToken.value;
  }

  private toCount(value: unknown): number | null {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0
      ? Math.floor(n)
      : null;
  }

  private errMsg(e: unknown): string {
    if (e && typeof e === 'object' && 'message' in e) {
      return String((e as { message: unknown }).message);
    }
    return String(e);
  }
}
