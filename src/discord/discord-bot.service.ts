import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

const CAPTAIN_ROLE_ID = '1415420108318183565';

const DIVISION_CATEGORY_IDS: Record<string, string> = {
  DIVISION_I: '1421318941875245129',
  DIVISION_II: '1476565539013922878',
  DIVISION_III: '1502067359542677625',
};

// Discord permission bit values as strings (Discord API expects string integers)
const VIEW_CHANNEL_BIT = 1024n; // 1 << 10
const CONNECT_BIT = 1048576n; // 1 << 20
const SPEAK_BIT = 2097152n; // 1 << 21
const TEAM_CHANNEL_ALLOW = String(VIEW_CHANNEL_BIT + CONNECT_BIT + SPEAK_BIT); // '3147776'
const TEAM_CHANNEL_DENY_EVERYONE = String(VIEW_CHANNEL_BIT); // '1024'

@Injectable()
export class DiscordBotService {
  private readonly logger = new Logger(DiscordBotService.name);

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
          { name: teamName, permissions: '0', mentionable: false },
          { headers: this.headers },
        ),
      );
      return (res.data as { id: string }).id;
    } catch (e) {
      this.logger.warn(`createTeamRole failed: ${this.errMsg(e)}`);
      return null;
    }
  }

  /** Creates a voice channel inside the division category. Returns the channel ID or null on failure. */
  async createDivisionVoiceChannel(
    teamName: string,
    division: string,
    teamRoleId: string,
  ): Promise<string | null> {
    if (!this.ready()) return null;
    const categoryId = DIVISION_CATEGORY_IDS[division];
    if (!categoryId) {
      this.logger.warn(`No category ID for division ${division}`);
      return null;
    }
    try {
      const res = await firstValueFrom(
        this.http.post(
          `https://discord.com/api/v10/guilds/${this.guildId}/channels`,
          {
            name: `🎤・${teamName}`,
            type: 2, // GUILD_VOICE
            parent_id: categoryId,
            permission_overwrites: [
              // Deny VIEW_CHANNEL for @everyone (role ID == guild ID)
              {
                id: this.guildId,
                type: 0,
                allow: '0',
                deny: TEAM_CHANNEL_DENY_EVERYONE,
              },
              // Allow VIEW_CHANNEL + CONNECT + SPEAK for the team role
              { id: teamRoleId, type: 0, allow: TEAM_CHANNEL_ALLOW, deny: '0' },
            ],
          },
          { headers: this.headers },
        ),
      );
      return (res.data as { id: string }).id;
    } catch (e) {
      this.logger.warn(`createDivisionVoiceChannel failed: ${this.errMsg(e)}`);
      return null;
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
    try {
      await firstValueFrom(
        this.http.put(
          `https://discord.com/api/v10/guilds/${this.guildId}/members/${discordId}/roles/${roleId}`,
          null,
          { headers: this.headers },
        ),
      );
    } catch (e) {
      this.logger.warn(
        `addMemberRole discordId=${discordId} roleId=${roleId} failed: ${this.errMsg(e)}`,
      );
    }
  }

  async removeMemberRole(discordId: string, roleId: string): Promise<void> {
    if (!this.ready() || !discordId) return;
    try {
      await firstValueFrom(
        this.http.delete(
          `https://discord.com/api/v10/guilds/${this.guildId}/members/${discordId}/roles/${roleId}`,
          { headers: this.headers },
        ),
      );
    } catch (e) {
      this.logger.warn(
        `removeMemberRole discordId=${discordId} roleId=${roleId} failed: ${this.errMsg(e)}`,
      );
    }
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
