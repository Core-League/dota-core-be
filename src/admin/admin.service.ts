import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { DataSource, DeepPartial, Repository } from 'typeorm';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { Role } from '../user-roles/role.constants';

const DISCORD_VERIFIED_ROLE_ID = '1498458326839591126';

export type VerifyResult = {
  playerId: string;
  verified: boolean;
  verifiedAt: Date | null;
};

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly playersRepo: Repository<Player>;
  private readonly rolesRepo: Repository<UserRoles>;

  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly http: HttpService,
  ) {
    this.playersRepo = dataSource.getRepository(Player);
    this.rolesRepo = dataSource.getRepository(UserRoles);
  }

  async verifyPlayer(playerId: string): Promise<VerifyResult> {
    const player = await this.findPlayerWithRoles(playerId);

    const nonAdminRoles = player.roles.filter((r) => !r.isAdminRole);
    if (nonAdminRoles.length > 1) {
      await this.rolesRepo.remove(nonAdminRoles.slice(1));
    }
    let role = nonAdminRoles[0];
    if (!role) {
      role = this.rolesRepo.create({
        isAdminRole: false,
      } as DeepPartial<UserRoles>);
      role.player = player;
    }
    role.name = Role.PLAYER;
    await this.rolesRepo.save(role);

    player.verifiedAt = new Date();
    await this.playersRepo.save(player);

    await this.setDiscordVerifiedRole(player.discordId, true);

    return { playerId, verified: true, verifiedAt: player.verifiedAt };
  }

  async unverifyPlayer(playerId: string): Promise<VerifyResult> {
    const player = await this.findPlayerWithRoles(playerId);

    const nonAdminRoles = player.roles.filter((r) => !r.isAdminRole);
    if (nonAdminRoles.length > 1) {
      await this.rolesRepo.remove(nonAdminRoles.slice(1));
    }
    const role = nonAdminRoles[0];
    if (role) {
      role.name = Role.GUEST;
      await this.rolesRepo.save(role);
    }

    player.verifiedAt = null;
    await this.playersRepo.save(player);

    await this.setDiscordVerifiedRole(player.discordId, false);

    return { playerId, verified: false, verifiedAt: null };
  }

  private async findPlayerWithRoles(playerId: string): Promise<Player> {
    const player = await this.playersRepo.findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    if (!player) throw new NotFoundException('Player not found');
    return player;
  }

  private async setDiscordVerifiedRole(
    discordId: string | null,
    add: boolean,
  ): Promise<void> {
    if (!discordId) return;
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    const guildId = process.env.DISCORD_SYNC_GUILD_ID?.trim();
    if (!token || !guildId) return;

    const url = `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${DISCORD_VERIFIED_ROLE_ID}`;
    try {
      if (add) {
        await firstValueFrom(
          this.http.put(url, null, {
            headers: { Authorization: `Bot ${token}` },
          }),
        );
      } else {
        await firstValueFrom(
          this.http.delete(url, {
            headers: { Authorization: `Bot ${token}` },
          }),
        );
      }
    } catch (e) {
      const err = e as AxiosError;
      const status = err.response?.status ?? 'unknown';
      this.logger.warn(
        `Failed to ${add ? 'add' : 'remove'} Discord verified role for user ${discordId} (HTTP ${status})`,
      );
    }
  }
}
