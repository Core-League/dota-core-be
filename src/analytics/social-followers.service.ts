import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { firstValueFrom } from 'rxjs';
import { SOCIAL_CHANNEL_CATALOG, SocialChannel } from './analytics.model';

export interface LiveFollowers {
  followers: number;
  fetchedAt: Date;
}

/** Desktop browser identity for the public-page fallbacks (bot UAs get login walls). */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

/** iPhone Safari identity — TikTok serves the full profile to mobile browsers only. */
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Twitch's own web client id — public, used by twitch.tv itself for anonymous GQL. */
const TWITCH_WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

/** Instagram's web app id — public, sent by instagram.com for anonymous profile reads. */
const INSTAGRAM_WEB_APP_ID = '936619743392459';

/**
 * Live follower counts, fetched straight from each platform and cached in
 * memory for {@link SocialFollowersService.TTL_MS}. Every fetcher is
 * best-effort: an official API is used when its credentials are configured,
 * otherwise the platform's public page / anonymous web endpoint is read. When
 * everything fails it resolves to `null` (keeping the last good value, if any)
 * and the dashboard falls back to the admin-entered number.
 *
 * - Discord: `GET /guilds/:id?with_counts=true` with the bot token, else the public invite.
 * - Telegram: Bot API `getChatMemberCount` with `TELEGRAM_BOT_TOKEN`, else the `t.me` preview page.
 * - YouTube: Data API v3 with `YOUTUBE_API_KEY`, else the channel page's `subscriberCountText`.
 * - Twitch: Helix with `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET`, else the anonymous web GQL.
 * - Instagram: Graph API with `INSTAGRAM_ACCESS_TOKEN`, else anonymous `web_profile_info`,
 *   else the profile page's `og:description` (both anonymous routes are often walled).
 * - TikTok: the mobile profile page's embedded `followerCount`.
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
      if (followers == null) {
        this.logger.warn(`Live followers for ${channel}: no count found`);
        return cached ?? null;
      }
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
      case SocialChannel.INSTAGRAM:
        return this.fetchInstagram();
      case SocialChannel.TIKTOK:
        return this.fetchTiktok();
      default:
        return Promise.resolve(null);
    }
  }

  // ─── Discord ───────────────────────────────────────────────────────────────

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

  // ─── Telegram ──────────────────────────────────────────────────────────────

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
    const html = await this.getHtml(`https://t.me/${handle}`);
    const $ = cheerio.load(html);
    const text = $('.tgme_page_extra').first().text();
    // `\s` already covers the NBSP thousands separator Telegram uses.
    const match = /([\d\s,.]+)\s*(subscribers|members)/i.exec(text);
    if (!match) return null;
    return this.toCount(Number(match[1].replace(/\D/g, '')));
  }

  // ─── YouTube ───────────────────────────────────────────────────────────────

  private async fetchYoutube(): Promise<number | null> {
    const handle = SOCIAL_CHANNEL_CATALOG[SocialChannel.YOUTUBE].handle;
    const key = process.env.YOUTUBE_API_KEY;
    if (key) {
      const res = await firstValueFrom(
        this.http.get<{
          items?: { statistics?: { subscriberCount?: string } }[];
        }>('https://www.googleapis.com/youtube/v3/channels', {
          params: { part: 'statistics', forHandle: `@${handle}`, key },
        }),
      );
      return this.toCount(res.data.items?.[0]?.statistics?.subscriberCount);
    }

    // The channel page (with `hl=en`) embeds the header as
    // "@Core_League⁩ • ⁨119 subscribers⁩" (bidi marks between) and, in the
    // accessibility label, "Core League @Core_League 119 subscribers". Both are
    // anchored on the handle so recommended channels on the same page don't match.
    // Older layouts used "subscriberCountText":{"simpleText":"1.2K subscribers"}.
    const html = await this.getHtml(`https://www.youtube.com/@${handle}`, {
      params: { hl: 'en', gl: 'US' },
      headers: { Cookie: 'CONSENT=YES+; PREF=hl=en' },
    });
    const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const byHandle = new RegExp(
      `@${escaped}[^"\\d]{0,24}?([\\d.,]+\\s*(?:[KMB]|thousand|million|billion)?)\\s+subscribers`,
      'i',
    );
    const match =
      byHandle.exec(html) ??
      /"subscriberCountText":\{"simpleText":"([^"]+)"/.exec(html) ??
      /"subscriberCountText":"([^"]+)"/.exec(html);
    if (!match) return null;
    return this.parseCompactCount(match[1]);
  }

  // ─── Twitch ────────────────────────────────────────────────────────────────

  private async fetchTwitch(): Promise<number | null> {
    const login = SOCIAL_CHANNEL_CATALOG[SocialChannel.TWITCH].handle;
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (clientId && clientSecret) {
      return this.fetchTwitchHelix(login, clientId, clientSecret);
    }

    // Anonymous web GraphQL — the same call twitch.tv makes for a logged-out visitor.
    const res = await firstValueFrom(
      this.http.post<{
        data?: { user?: { followers?: { totalCount?: number } | null } | null };
      }>(
        'https://gql.twitch.tv/gql',
        {
          query: `query { user(login: "${login}") { followers { totalCount } } }`,
        },
        {
          headers: {
            'Client-Id': TWITCH_WEB_CLIENT_ID,
            'Content-Type': 'application/json',
            'User-Agent': BROWSER_UA,
          },
        },
      ),
    );
    return this.toCount(res.data.data?.user?.followers?.totalCount);
  }

  private async fetchTwitchHelix(
    login: string,
    clientId: string,
    clientSecret: string,
  ): Promise<number | null> {
    const token = await this.getTwitchToken(clientId, clientSecret);
    const headers = { 'Client-Id': clientId, Authorization: `Bearer ${token}` };

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

  // ─── Instagram ─────────────────────────────────────────────────────────────

  private async fetchInstagram(): Promise<number | null> {
    const handle = SOCIAL_CHANNEL_CATALOG[SocialChannel.INSTAGRAM].handle;

    // 1. Official Graph API (business / creator account linked to a Facebook page).
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (accessToken) {
      const userId = process.env.INSTAGRAM_USER_ID || 'me';
      const res = await firstValueFrom(
        this.http.get<{ followers_count?: number }>(
          `https://graph.facebook.com/v19.0/${userId}`,
          { params: { fields: 'followers_count', access_token: accessToken } },
        ),
      );
      const count = this.toCount(res.data.followers_count);
      if (count != null) return count;
    }

    // 2. Anonymous web profile endpoint (what instagram.com itself calls). Instagram
    //    rate-limits or login-walls this per IP, so it is best-effort only.
    try {
      const res = await firstValueFrom(
        this.http.get<{
          data?: { user?: { edge_followed_by?: { count?: number } } };
        }>('https://i.instagram.com/api/v1/users/web_profile_info/', {
          params: { username: handle },
          headers: {
            'User-Agent': BROWSER_UA,
            'X-IG-App-ID': INSTAGRAM_WEB_APP_ID,
            Accept: 'application/json',
          },
        }),
      );
      const count = this.toCount(res.data.data?.user?.edge_followed_by?.count);
      if (count != null) return count;
    } catch (e) {
      this.logger.debug(
        `Instagram web_profile_info failed, trying og:description: ${this.errMsg(e)}`,
      );
    }

    // 3. Public profile page: <meta property="og:description" content="1,234 Followers, …">
    const html = await this.getHtml(`https://www.instagram.com/${handle}/`);
    const $ = cheerio.load(html);
    const description =
      $('meta[property="og:description"]').attr('content') ??
      $('meta[name="description"]').attr('content') ??
      '';
    const match = /([\d.,\s]+[KMB]?)\s*Followers/i.exec(description);
    if (!match) return null;
    return this.parseCompactCount(match[1]);
  }

  // ─── TikTok ────────────────────────────────────────────────────────────────

  private async fetchTiktok(): Promise<number | null> {
    const handle = SOCIAL_CHANNEL_CATALOG[SocialChannel.TIKTOK].handle;
    // The desktop page answers a WAF challenge shell to non-browser clients; the
    // mobile page ships the full profile with its stats JSON: "followerCount":1234
    const html = await this.getHtml(`https://www.tiktok.com/@${handle}`, {
      params: { lang: 'en' },
      headers: { 'User-Agent': MOBILE_UA },
    });
    const match =
      /"followerCount":\s*(\d+)/.exec(html) ??
      /"followerCount":\s*"(\d+)"/.exec(html);
    if (match) return this.toCount(Number(match[1]));

    // Older markup: <strong data-e2e="followers-count">1.2K</strong>
    const $ = cheerio.load(html);
    const text = $('[data-e2e="followers-count"]').first().text();
    return text ? this.parseCompactCount(text) : null;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async getHtml(
    url: string,
    options: {
      params?: Record<string, string>;
      headers?: Record<string, string>;
    } = {},
  ): Promise<string> {
    const res = await firstValueFrom(
      this.http.get<string>(url, {
        responseType: 'text',
        params: options.params,
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'text/html,application/xhtml+xml',
          ...options.headers,
        },
      }),
    );
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  }

  /**
   * Parses a human-readable count as platforms render it: "1,234", "12 345",
   * "1.2K", "1,2K", "3.4M", "1,2 тис.", "2 млн". A thousands separator with
   * no suffix is stripped; a comma or dot before a suffix is a decimal mark.
   */
  private parseCompactCount(raw: string): number | null {
    // The whitespace class in the regex below also matches the NBSP thousands separator.
    const text = raw.trim().toLowerCase();
    const match =
      /(\d[\d\s.,]*)\s*(k|m|b|тис|млн|млрд|thousand|million|billion)?/i.exec(
        text,
      );
    if (!match) return null;

    const suffix = match[2];
    const multiplier = !suffix
      ? 1
      : /^(k|тис|thousand)/.test(suffix)
        ? 1_000
        : /^(m|млн|million)/.test(suffix)
          ? 1_000_000
          : 1_000_000_000;

    const digits = match[1].replace(/\s/g, '');
    const value = suffix
      ? Number(digits.replace(',', '.'))
      : Number(digits.replace(/[.,]/g, ''));
    return this.toCount(value * multiplier);
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
