import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class DiscordBotService {
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

  /** All guild roles; also refreshes the name → id cache. Empty on failure. */
  async listGuildRoles(): Promise<GuildRole[]> {
    if (!this.ready()) return [];
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
      this.logger.warn(`listGuildRoles failed: ${this.errMsg(e)}`);
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
   * Mirrors a player's LAN cities onto guild roles named after the city
   * (Ukrainian name, yellow). Cities added get their role (created on first
   * use); cities dropped lose it. Roles themselves are never deleted — other
   * players may still hold them.
   */
  async syncLanCityRoles(
    discordId: string,
    nextCities: readonly string[],
    prevCities: readonly string[],
  ): Promise<void> {
    if (!this.ready() || !discordId) return;
    const next = new Set(nextCities.map((c) => c.trim()).filter(Boolean));
    const prev = new Set(prevCities.map((c) => c.trim()).filter(Boolean));

    for (const city of next) {
      if (prev.has(city)) continue;
      const roleId = await this.ensureRoleByName(city, LAN_CITY_ROLE_COLOR);
      if (roleId) await this.addMemberRole(discordId, roleId);
    }
    for (const city of prev) {
      if (next.has(city)) continue;
      const roleId = await this.findRoleIdByName(city);
      if (roleId) await this.removeMemberRole(discordId, roleId);
    }
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

  private errMsg(e: unknown): string {
    const err = e as AxiosError;
    return `HTTP ${err.response?.status ?? 'unknown'}`;
  }
}
