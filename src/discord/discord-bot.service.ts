import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

const CAPTAIN_ROLE_ID = '1415420108318183565';

// Roles that always get access to every team voice channel
const STAFF_FULL_ACCESS_ROLE_ID = '1408215246589394964';
const VIEW_JOIN_ROLE_IDS = ['1399031107835400385', '1399452821362966728'];

// Every team voice channel lands in this one category.
const TEAM_VOICE_CATEGORY_ID = '1421318941875245129';

// Discord permission bit values (Discord API expects string integers)
const MANAGE_CHANNELS_BIT = 16n; // 1 << 4
const PRIORITY_SPEAKER_BIT = 256n; // 1 << 8
const STREAM_BIT = 512n; // 1 << 9
const VIEW_CHANNEL_BIT = 1024n; // 1 << 10
const CONNECT_BIT = 1048576n; // 1 << 20
const SPEAK_BIT = 2097152n; // 1 << 21
const MUTE_MEMBERS_BIT = 4194304n; // 1 << 22
const DEAFEN_MEMBERS_BIT = 8388608n; // 1 << 23
const MOVE_MEMBERS_BIT = 16777216n; // 1 << 24
const USE_VAD_BIT = 33554432n; // 1 << 25

const TEAM_CHANNEL_ALLOW = String(VIEW_CHANNEL_BIT + CONNECT_BIT + SPEAK_BIT); // '3147776'
const TEAM_CHANNEL_DENY_EVERYONE = String(VIEW_CHANNEL_BIT); // '1024'

// Staff role: full voice channel control
const STAFF_CHANNEL_ALLOW = String(
  MANAGE_CHANNELS_BIT +
    PRIORITY_SPEAKER_BIT +
    STREAM_BIT +
    VIEW_CHANNEL_BIT +
    CONNECT_BIT +
    SPEAK_BIT +
    MUTE_MEMBERS_BIT +
    DEAFEN_MEMBERS_BIT +
    MOVE_MEMBERS_BIT +
    USE_VAD_BIT,
); // '66062096'

// Moderator roles: can see and join but not speak by default
const VIEW_JOIN_ALLOW = String(VIEW_CHANNEL_BIT + CONNECT_BIT); // '1049600'

/** Discord's preset "Yellow" — colour of every LAN-city role. */
export const LAN_CITY_ROLE_COLOR = 0xfee75c;

interface GuildRole {
  id: string;
  name: string;
  color: number;
}

/** Outcome of one city-role sync — surfaced by POST /players/me/lan-roles/sync. */
export interface CityRoleSyncReport {
  /** False when DISCORD_BOT_TOKEN / DISCORD_SYNC_GUILD_ID are missing. */
  configured: boolean;
  /** Roles created in the guild during this run (by city name). */
  created: string[];
  /** Roles now on the member (by city name). */
  assigned: string[];
  /** Roles taken off the member (by city name). */
  removed: string[];
  /** Human-readable failures, e.g. `assign "Львів": HTTP 403 Missing Permissions (50013)`. */
  errors: string[];
}

@Injectable()
export class DiscordBotService implements OnModuleInit {
  private readonly logger = new Logger(DiscordBotService.name);

  /** name → role id, filled from the guild role list; refreshed on a miss. */
  private readonly roleIdByName = new Map<string, string>();

  constructor(private readonly http: HttpService) {}

  private get guildId(): string | undefined {
    return process.env.DISCORD_SYNC_GUILD_ID?.trim();
  }

  private get token(): string | undefined {
    return process.env.DISCORD_BOT_TOKEN?.trim();
  }

  private get headers() {
    return { Authorization: `Bot ${this.token}` };
  }

  private ready(): boolean {
    return !!(this.token && this.guildId);
  }

  /**
   * Boot-time sanity check: one `GET /users/@me` with the bot token, logged at
   * `log` (accepted) or `error` (rejected). A bad DISCORD_BOT_TOKEN used to
   * surface only as a `warn` on the first role write, easy to miss.
   */
  async onModuleInit(): Promise<void> {
    if (!this.ready()) {
      this.logger.warn(
        'Discord bot disabled: DISCORD_BOT_TOKEN or DISCORD_SYNC_GUILD_ID is not set',
      );
      return;
    }
    try {
      const res = await firstValueFrom(
        this.http.get<{ id: string; username: string }>(
          'https://discord.com/api/v10/users/@me',
          { headers: this.headers },
        ),
      );
      this.logger.log(
        `Discord bot token accepted (bot user ${res.data.username}, guild ${this.guildId})`,
      );
    } catch (e) {
      this.logger.error(
        `Discord bot token rejected: ${this.errMsg(e)}. ${this.tokenShapeHint()}`,
      );
    }
  }

  /**
   * Describes the token's *shape* without revealing it: length plus whether it
   * carries a `Bot ` prefix or surrounding quotes — the two most common paste
   * mistakes when the secret is entered in the GitHub Environment.
   */
  private tokenShapeHint(): string {
    const raw = this.token ?? '';
    const issues: string[] = [];
    if (/^Bot\s/i.test(raw))
      issues.push('has a "Bot " prefix (the code adds it)');
    if (/^["']|["']$/.test(raw)) issues.push('is wrapped in quotes');
    if (/\s/.test(raw)) issues.push('contains whitespace');
    if (raw.length < 50) issues.push('is shorter than a bot token (~70 chars)');
    return issues.length
      ? `Token ${issues.join(', ')} — length ${raw.length}.`
      : `Token length ${raw.length} looks normal; it was likely reset in the Developer Portal or is not this application's bot token.`;
  }

  /** Creates a Discord role for the team. Returns the role ID or null on failure. */
  async createTeamRole(teamName: string): Promise<string | null> {
    if (!this.ready()) return null;
    try {
      const res = await firstValueFrom(
        this.http.post(
          `https://discord.com/api/v10/guilds/${this.guildId}/roles`,
          {
            name: teamName,
            color: 0x43bfee,
            permissions: '0',
            mentionable: false,
          },
          { headers: this.headers },
        ),
      );
      return (res.data as { id: string }).id;
    } catch (e) {
      this.logger.warn(`createTeamRole failed: ${this.errMsg(e)}`);
      return null;
    }
  }

  /** Creates the team's private voice channel. Returns the channel ID or null on failure. */
  async createTeamVoiceChannel(
    teamName: string,
    teamRoleId: string,
  ): Promise<string | null> {
    if (!this.ready()) return null;
    try {
      const res = await firstValueFrom(
        this.http.post(
          `https://discord.com/api/v10/guilds/${this.guildId}/channels`,
          {
            name: `🎤・${teamName}`,
            type: 2, // GUILD_VOICE
            parent_id: TEAM_VOICE_CATEGORY_ID,
            permission_overwrites: [
              // @everyone: deny VIEW_CHANNEL (channel is private)
              {
                id: this.guildId,
                type: 0,
                allow: '0',
                deny: TEAM_CHANNEL_DENY_EVERYONE,
              },
              // Team role: view + connect + speak
              { id: teamRoleId, type: 0, allow: TEAM_CHANNEL_ALLOW, deny: '0' },
              // Staff role: full voice access
              {
                id: STAFF_FULL_ACCESS_ROLE_ID,
                type: 0,
                allow: STAFF_CHANNEL_ALLOW,
                deny: '0',
              },
              // Moderator roles: view + connect
              ...VIEW_JOIN_ROLE_IDS.map((id) => ({
                id,
                type: 0,
                allow: VIEW_JOIN_ALLOW,
                deny: '0',
              })),
            ],
          },
          { headers: this.headers },
        ),
      );
      return (res.data as { id: string }).id;
    } catch (e) {
      this.logger.warn(`createTeamVoiceChannel failed: ${this.errMsg(e)}`);
      return null;
    }
  }

  /** Last Discord error text from listGuildRoles, for the sync report. */
  private lastError: string | null = null;

  /** All guild roles; also refreshes the name → id cache. Empty on failure. */
  async listGuildRoles(): Promise<GuildRole[]> {
    if (!this.ready()) return [];
    this.lastError = null;
    try {
      const res = await firstValueFrom(
        this.http.get<GuildRole[]>(
          `https://discord.com/api/v10/guilds/${this.guildId}/roles`,
          { headers: this.headers },
        ),
      );
      const roles = Array.isArray(res.data) ? res.data : [];
      this.roleIdByName.clear();
      for (const r of roles) this.roleIdByName.set(r.name, r.id);
      return roles;
    } catch (e) {
      this.lastError = this.errMsg(e);
      this.logger.warn(`listGuildRoles failed: ${this.lastError}`);
      return [];
    }
  }

  /** Role id for an exact name, or null when the guild has no such role. */
  async findRoleIdByName(name: string): Promise<string | null> {
    if (!this.ready()) return null;
    const cached = this.roleIdByName.get(name);
    if (cached) return cached;
    await this.listGuildRoles();
    return this.roleIdByName.get(name) ?? null;
  }

  /**
   * Role id for an exact name, creating the role (with `color`) when the guild
   * does not have one yet. Null only when Discord is unavailable.
   */
  async ensureRoleByName(name: string, color: number): Promise<string | null> {
    const existing = await this.findRoleIdByName(name);
    if (existing) return existing;
    if (!this.ready()) return null;
    try {
      const res = await firstValueFrom(
        this.http.post<GuildRole>(
          `https://discord.com/api/v10/guilds/${this.guildId}/roles`,
          { name, color, permissions: '0', mentionable: false },
          { headers: this.headers },
        ),
      );
      const id = res.data.id;
      this.roleIdByName.set(name, id);
      return id;
    } catch (e) {
      this.logger.warn(`ensureRoleByName "${name}" failed: ${this.errMsg(e)}`);
      return null;
    }
  }

  /**
   * Mirrors a player's cities (home city + LAN cities) onto guild roles named
   * after the city (Ukrainian name, yellow). Every current city gets its role
   * (created on first use); cities dropped since `prevCities` lose it. Roles
   * themselves are never deleted — other players may still hold them.
   */
  async syncCityRoles(
    discordId: string,
    nextCities: readonly string[],
    prevCities: readonly string[],
  ): Promise<CityRoleSyncReport> {
    const report: CityRoleSyncReport = {
      configured: this.ready(),
      created: [],
      assigned: [],
      removed: [],
      errors: [],
    };
    if (!report.configured) {
      report.errors.push(
        'Discord bot is not configured (DISCORD_BOT_TOKEN / DISCORD_SYNC_GUILD_ID)',
      );
      return report;
    }
    if (!discordId) {
      report.errors.push('Player has no linked Discord account');
      return report;
    }

    const next = new Set(nextCities.map((c) => c.trim()).filter(Boolean));
    const prev = new Set(prevCities.map((c) => c.trim()).filter(Boolean));
    const base = `https://discord.com/api/v10/guilds/${this.guildId}`;

    // Refresh the role list once per run so name lookups are exact and current.
    const roles = await this.listGuildRoles();
    if (!roles.length && this.lastError) {
      report.errors.push(`list roles: ${this.lastError}`);
      if (this.lastError.startsWith('HTTP 401')) {
        report.errors.push(
          `DISCORD_BOT_TOKEN is rejected by Discord. ${this.tokenShapeHint()}`,
        );
        return report;
      }
    }

    // Every current city is (re)assigned, not only the newly added ones: PUT on
    // a role the member already holds is a no-op for Discord, and this heals
    // players whose cities were saved before the bot sync existed.
    for (const city of next) {
      let roleId = this.roleIdByName.get(city) ?? null;
      if (!roleId) {
        try {
          const res = await firstValueFrom(
            this.http.post<GuildRole>(
              `${base}/roles`,
              {
                name: city,
                color: LAN_CITY_ROLE_COLOR,
                permissions: '0',
                mentionable: false,
              },
              { headers: this.headers },
            ),
          );
          roleId = res.data.id;
          this.roleIdByName.set(city, roleId);
          report.created.push(city);
        } catch (e) {
          report.errors.push(`create "${city}": ${this.errMsg(e)}`);
          continue;
        }
      }
      try {
        await firstValueFrom(
          this.http.put(`${base}/members/${discordId}/roles/${roleId}`, null, {
            headers: this.headers,
          }),
        );
        report.assigned.push(city);
      } catch (e) {
        report.errors.push(`assign "${city}": ${this.errMsg(e)}`);
      }
    }

    for (const city of prev) {
      if (next.has(city)) continue;
      const roleId = this.roleIdByName.get(city);
      if (!roleId) continue;
      try {
        await firstValueFrom(
          this.http.delete(`${base}/members/${discordId}/roles/${roleId}`, {
            headers: this.headers,
          }),
        );
        report.removed.push(city);
      } catch (e) {
        report.errors.push(`remove "${city}": ${this.errMsg(e)}`);
      }
    }

    if (report.errors.length) {
      this.logger.warn(
        `City roles for ${discordId}: ${report.errors.join('; ')}`,
      );
    }
    return report;
  }

  async updateRoleColor(roleId: string, color: number): Promise<void> {
    if (!this.ready()) return;
    try {
      await firstValueFrom(
        this.http.patch(
          `https://discord.com/api/v10/guilds/${this.guildId}/roles/${roleId}`,
          { color },
          { headers: this.headers },
        ),
      );
    } catch (e) {
      this.logger.warn(`updateRoleColor ${roleId} failed: ${this.errMsg(e)}`);
    }
  }

  async deleteRole(roleId: string): Promise<void> {
    if (!this.ready()) return;
    try {
      await firstValueFrom(
        this.http.delete(
          `https://discord.com/api/v10/guilds/${this.guildId}/roles/${roleId}`,
          { headers: this.headers },
        ),
      );
    } catch (e) {
      this.logger.warn(`deleteRole ${roleId} failed: ${this.errMsg(e)}`);
    }
  }

  async deleteChannel(channelId: string): Promise<void> {
    if (!this.ready()) return;
    try {
      await firstValueFrom(
        this.http.delete(`https://discord.com/api/v10/channels/${channelId}`, {
          headers: this.headers,
        }),
      );
    } catch (e) {
      this.logger.warn(`deleteChannel ${channelId} failed: ${this.errMsg(e)}`);
    }
  }

  async addMemberRole(discordId: string, roleId: string): Promise<void> {
    if (!this.ready() || !discordId) return;
    const url = `https://discord.com/api/v10/guilds/${this.guildId}/members/${discordId}/roles/${roleId}`;
    await this.putWithRetry(
      url,
      `addMemberRole discordId=${discordId} roleId=${roleId}`,
    );
  }

  async removeMemberRole(discordId: string, roleId: string): Promise<void> {
    if (!this.ready() || !discordId) return;
    const url = `https://discord.com/api/v10/guilds/${this.guildId}/members/${discordId}/roles/${roleId}`;
    await this.deleteWithRetry(
      url,
      `removeMemberRole discordId=${discordId} roleId=${roleId}`,
    );
  }

  private async putWithRetry(url: string, label: string): Promise<void> {
    try {
      await firstValueFrom(this.http.put(url, null, { headers: this.headers }));
    } catch (e) {
      const retryMs = this.retryAfterMs(e);
      if (retryMs !== null) {
        this.logger.warn(`${label} rate limited, retrying in ${retryMs}ms`);
        await new Promise((r) => setTimeout(r, retryMs));
        try {
          await firstValueFrom(
            this.http.put(url, null, { headers: this.headers }),
          );
        } catch (e2) {
          this.logger.warn(`${label} retry failed: ${this.errMsg(e2)}`);
        }
      } else {
        this.logger.warn(`${label} failed: ${this.errMsg(e)}`);
      }
    }
  }

  private async deleteWithRetry(url: string, label: string): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(url, { headers: this.headers }));
    } catch (e) {
      const retryMs = this.retryAfterMs(e);
      if (retryMs !== null) {
        this.logger.warn(`${label} rate limited, retrying in ${retryMs}ms`);
        await new Promise((r) => setTimeout(r, retryMs));
        try {
          await firstValueFrom(
            this.http.delete(url, { headers: this.headers }),
          );
        } catch (e2) {
          this.logger.warn(`${label} retry failed: ${this.errMsg(e2)}`);
        }
      } else {
        this.logger.warn(`${label} failed: ${this.errMsg(e)}`);
      }
    }
  }

  /** Returns retry delay in ms if the error is a 429, otherwise null. */
  private retryAfterMs(e: unknown): number | null {
    const err = e as AxiosError;
    if (err.response?.status !== 429) return null;
    const body = err.response.data as { retry_after?: number };
    const seconds = body?.retry_after ?? 1;
    return Math.ceil(seconds * 1000) + 100; // +100ms buffer
  }

  async addCaptainRole(discordId: string): Promise<void> {
    return this.addMemberRole(discordId, CAPTAIN_ROLE_ID);
  }

  async removeCaptainRole(discordId: string): Promise<void> {
    return this.removeMemberRole(discordId, CAPTAIN_ROLE_ID);
  }

  /** Adds a list of players (by discordId) to a role, skipping nulls. */
  async setVerifiedRole(discordId: string, add: boolean): Promise<void> {
    if (!this.ready() || !discordId) return;
    const VERIFIED_ROLE_ID = '1498458326839591126';
    if (add) {
      await this.addMemberRole(discordId, VERIFIED_ROLE_ID);
    } else {
      await this.removeMemberRole(discordId, VERIFIED_ROLE_ID);
    }
  }

  async addPlayersToRole(
    players: Array<{ discordId: string | null }>,
    roleId: string,
  ): Promise<void> {
    for (const p of players) {
      if (p.discordId) await this.addMemberRole(p.discordId, roleId);
    }
  }

  /** Removes a list of players from a role, skipping nulls. */
  async removePlayersFromRole(
    players: Array<{ discordId: string | null }>,
    roleId: string,
  ): Promise<void> {
    for (const p of players) {
      if (p.discordId) await this.removeMemberRole(p.discordId, roleId);
    }
  }

  /** `HTTP <status> <Discord message> (<Discord code>)` when Discord answered, else the transport error. */
  private errMsg(e: unknown): string {
    const err = e as AxiosError<{ message?: string; code?: number }>;
    if (!err.response) return err.message || 'network error';
    const body = err.response.data;
    const detail = body?.message
      ? ` ${body.message}${body.code != null ? ` (${body.code})` : ''}`
      : '';
    return `HTTP ${err.response.status}${detail}`;
  }
}
