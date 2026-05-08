import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, DeepPartial, Repository } from 'typeorm';
import { Player } from '../players/player.entity';
import { Team } from '../teams/team.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { Role, RoleName } from '../user-roles/role.constants';
import { TournamentDivision } from '../tournaments/tournaments.model';
import { DiscordBotService } from '../discord/discord-bot.service';

function computeTeamDivision(
  players: { rating: number }[],
): TournamentDivision | null {
  if (!players.length) return null;
  const ratings = players.map((p) => p.rating);
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  const max = Math.max(...ratings);
  if (avg <= 2500 && max <= 3500) return TournamentDivision.DIVISION_I;
  if (avg <= 4500 && max <= 5500) return TournamentDivision.DIVISION_II;
  if (avg <= 7000) return TournamentDivision.DIVISION_III;
  return null;
}

export type DiscordSyncResult = {
  processed: number;
  rolesCreated: number;
  channelsCreated: number;
  skipped: number;
};

export type VerifyResult = {
  playerId: string;
  verified: boolean;
  verifiedAt: Date | null;
};

export type PlayerRoleResult = {
  playerId: string;
  name: RoleName;
  verifiedAt: Date | null;
};

export type AdminRoleResult = {
  playerId: string;
  isAdmin: boolean;
};

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly playersRepo: Repository<Player>;
  private readonly rolesRepo: Repository<UserRoles>;
  private readonly teamsRepo: Repository<Team>;

  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly discord: DiscordBotService,
  ) {
    this.playersRepo = dataSource.getRepository(Player);
    this.rolesRepo = dataSource.getRepository(UserRoles);
    this.teamsRepo = dataSource.getRepository(Team);
  }

  async verifyPlayer(playerId: string): Promise<VerifyResult> {
    const result = await this.setPrimaryRole(playerId, Role.PLAYER);
    return {
      playerId: result.playerId,
      verified: true,
      verifiedAt: result.verifiedAt,
    };
  }

  async unverifyPlayer(playerId: string): Promise<VerifyResult> {
    const result = await this.setPrimaryRole(playerId, Role.GUEST);
    return {
      playerId: result.playerId,
      verified: false,
      verifiedAt: result.verifiedAt,
    };
  }

  setPlayerRole(playerId: string, name: RoleName): Promise<PlayerRoleResult> {
    return this.setPrimaryRole(playerId, name);
  }

  /**
   * Idempotently ensures the player has an `isAdminRole=true` row. Does not
   * touch the player's primary (non-admin) role row or `verifiedAt`. No
   * Discord side-effects (no admin Discord role is wired today).
   */
  async grantAdmin(playerId: string): Promise<AdminRoleResult> {
    const player = await this.findPlayerWithRoles(playerId);

    const hasAdmin = (player.roles ?? []).some((r) => r.isAdminRole);
    if (!hasAdmin) {
      const adminRole = this.rolesRepo.create({
        name: Role.ADMIN,
        isAdminRole: true,
      } as DeepPartial<UserRoles>);
      adminRole.player = player;
      await this.rolesRepo.save(adminRole);
    }

    return { playerId, isAdmin: true };
  }

  /**
   * Removes all `isAdminRole=true` rows for the player. Throws 403 if the
   * actor is revoking their own admin (avoids accidental lockout).
   */
  async revokeAdmin(
    playerId: string,
    actorPlayerId: string,
  ): Promise<AdminRoleResult> {
    if (playerId === actorPlayerId) {
      throw new ForbiddenException('Cannot revoke your own admin role');
    }

    const player = await this.findPlayerWithRoles(playerId);
    const adminRoles = (player.roles ?? []).filter((r) => r.isAdminRole);
    if (adminRoles.length > 0) {
      await this.rolesRepo.remove(adminRoles);
    }

    return { playerId, isAdmin: false };
  }

  /**
   * Single source of truth for primary (non-admin) role mutations. Enforces
   * the "one non-admin role row per player" invariant, syncs `verifiedAt` for
   * Гравець/Гість, and toggles the Discord verified role accordingly.
   * Other role names (Медіа, Капітан) leave `verifiedAt` and Discord state untouched.
   */
  private async setPrimaryRole(
    playerId: string,
    name: RoleName,
  ): Promise<PlayerRoleResult> {
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
    role.name = name;
    await this.rolesRepo.save(role);

    if (name === Role.PLAYER) {
      player.verifiedAt = new Date();
      await this.playersRepo.save(player);
    } else if (name === Role.GUEST) {
      player.verifiedAt = null;
      await this.playersRepo.save(player);
    }

    if (player.discordId) {
      if (name === Role.PLAYER) {
        await this.discord.setVerifiedRole(player.discordId, true);
      } else if (name === Role.GUEST) {
        await this.discord.setVerifiedRole(player.discordId, false);
      }
    }

    return { playerId, name, verifiedAt: player.verifiedAt };
  }

  async syncDiscord(): Promise<DiscordSyncResult> {
    const teams = await this.teamsRepo.find({
      where: { isVerified: true },
      relations: ['captain', 'coach', 'mainPlayers', 'reservedPlayers'],
    });

    let rolesCreated = 0;
    let channelsCreated = 0;
    let skipped = 0;

    for (const team of teams) {
      const division = computeTeamDivision(team.mainPlayers ?? []);
      if (!division) {
        this.logger.warn(
          `syncDiscord: team ${team.id} (${team.name}) has no determinable division — skipped`,
        );
        skipped++;
        continue;
      }

      let roleId = team.discordRoleId;
      if (!roleId) {
        roleId = await this.discord.createTeamRole(team.name);
        if (roleId) {
          rolesCreated++;
        } else {
          this.logger.warn(
            `syncDiscord: failed to create role for team ${team.id}`,
          );
          skipped++;
          continue;
        }
      }

      let channelId = team.discordChannelId;
      if (!channelId) {
        channelId = await this.discord.createDivisionVoiceChannel(
          team.name,
          division,
          roleId,
        );
        if (channelId) {
          channelsCreated++;
        }
      }

      await this.discord.updateRoleColor(roleId, 0x43bfee);

      if (
        roleId !== team.discordRoleId ||
        channelId !== team.discordChannelId
      ) {
        await this.teamsRepo.save(
          Object.assign(team, {
            discordRoleId: roleId,
            discordChannelId: channelId,
          }),
        );
      }

      const members = [
        team.captain,
        team.coach,
        ...(team.mainPlayers ?? []),
        ...(team.reservedPlayers ?? []),
      ].filter(Boolean) as Player[];

      await this.discord.addPlayersToRole(members, roleId);

      if (team.captain?.discordId) {
        await this.discord.addCaptainRole(team.captain.discordId);
      }
    }

    return {
      processed: teams.length - skipped,
      rolesCreated,
      channelsCreated,
      skipped,
    };
  }

  private async findPlayerWithRoles(playerId: string): Promise<Player> {
    const player = await this.playersRepo.findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    if (!player) throw new NotFoundException('Player not found');
    return player;
  }
}
