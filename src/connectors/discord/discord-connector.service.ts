import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

/**
 * Minimal v2 Discord REST client: toggles a guild member's roles. Mirrors the
 * v1 DiscordBotService member-role helpers but carries none of its team/channel
 * logic. Every method no-ops when the bot is unconfigured and swallows its own
 * errors (logs only), so callers can fire-and-forget without a Discord outage
 * failing their request — same contract as Dota2Service.addLeagueAdmin.
 */
@Injectable()
export class DiscordConnectorService {
  private readonly logger = new Logger(DiscordConnectorService.name);

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

  /** Adds `roleId` to each Discord user, skipping empties. */
  async grantRole(discordIds: string[], roleId: string): Promise<void> {
    for (const id of discordIds) {
      await this.addMemberRole(id, roleId);
    }
  }

  /** Removes `roleId` from each Discord user, skipping empties. */
  async revokeRole(discordIds: string[], roleId: string): Promise<void> {
    for (const id of discordIds) {
      await this.removeMemberRole(id, roleId);
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

  private errMsg(e: unknown): string {
    const err = e as AxiosError;
    return `HTTP ${err.response?.status ?? 'unknown'}`;
  }
}
