import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, DeepPartial, EntityManager, Repository } from 'typeorm';
import { Player } from '../players/player.entity';
import { Team } from '../teams/team.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import {
  getRoleColorByName,
  Role,
  RoleName,
  ROLE_NAMES,
} from '../user-roles/role.constants';
import { TournamentDivision } from '../tournaments/tournaments.model';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import { QualificationMatch } from '../qualification/qualification-match.entity';
import { DiscordBotService } from '../discord/discord-bot.service';
import { OverrideMatchResultDto } from './dto/override-match-result.dto';
import { AuthService } from '../auth/auth.service';
import {
  AdminPlayerRoleItemDto,
  AdminSetPlayerRolesDto,
} from './dto/admin-set-player-roles.dto';

function computeTeamDivision(
  players: { rating: number }[],
): TournamentDivision | null {
  if (!players.length) return null;
  const maxRating = Math.max(...players.map((p) => p.rating));
  if (maxRating <= 3500) return TournamentDivision.DIVISION_I;
  if (maxRating <= 5500) return TournamentDivision.DIVISION_II;
  if (maxRating <= 7000) return TournamentDivision.DIVISION_III;
  return null;
}

/** Одна «базова» роль: Гість / Гравець / Медіа. Капітан — окремий рядок, не чіпаємо тут. */
const PRIMARY_TIER_NAMES = new Set<RoleName>([
  Role.GUEST,
  Role.PLAYER,
  Role.MEDIA,
]);

function isPrimaryTierName(name: string): boolean {
  return PRIMARY_TIER_NAMES.has(name as RoleName);
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

export type AdminPlayerRolesResult = {
  playerId: string;
  verifiedAt: Date | null;
  roles: {
    id: string;
    name: string;
    isAdminRole: boolean;
    color: string;
  }[];
};

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly playersRepo: Repository<Player>;
  private readonly rolesRepo: Repository<UserRoles>;
  private readonly teamsRepo: Repository<Team>;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly discord: DiscordBotService,
    private readonly authService: AuthService,
  ) {
    this.playersRepo = dataSource.getRepository(Player);
    this.rolesRepo = dataSource.getRepository(UserRoles);
    this.teamsRepo = dataSource.getRepository(Team);
  }

  async setPlayerRoles(
    playerId: string,
    dto: AdminSetPlayerRolesDto,
  ): Promise<AdminPlayerRolesResult> {
    const items = dto.roles ?? [];
    this.assertValidRoleAssignmentList(items);

    await this.dataSource.transaction(async (manager) => {
      const player = await manager
        .createQueryBuilder(Player, 'p')
        .where('p.id = :playerId', { playerId })
        .getOne();
      if (!player) throw new NotFoundException('Player not found');

      await manager
        .createQueryBuilder()
        .delete()
        .from(UserRoles)
        .where('"playerId" = :playerId', { playerId })
        .execute();

      if (items.length > 0) {
        const placeholders = items
          .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
          .join(', ');
        const params = items.flatMap((row) => [
          row.name,
          row.isAdminRole,
          playerId,
        ]);
        await manager.query(
          `INSERT INTO "user_roles" (name, "isAdminRole", "playerId") VALUES ${placeholders}`,
          params,
        );
      }

      const hasPlayerTier = items.some(
        (r) => !r.isAdminRole && r.name === Role.PLAYER,
      );
      const newVerifiedAt = hasPlayerTier
        ? (player.verifiedAt ?? new Date())
        : null;
      await manager
        .createQueryBuilder()
        .update(Player)
        .set({ verifiedAt: newVerifiedAt })
        .where('id = :playerId', { playerId })
        .execute();
    });

    const updated = await this.findPlayerWithRoles(playerId);
    await this.authService.syncPlayerGuildRoles(updated);
    return this.toAdminRolesResult(updated);
  }

  private toAdminRolesResult(player: Player): AdminPlayerRolesResult {
    return {
      playerId: player.id,
      verifiedAt: player.verifiedAt ?? null,
      roles: (player.roles ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        isAdminRole: r.isAdminRole,
        color: getRoleColorByName(r.name) ?? '#64748B',
      })),
    };
  }

  private assertValidRoleAssignmentList(items: AdminPlayerRoleItemDto[]): void {
    for (const row of items) {
      if (!(ROLE_NAMES as readonly string[]).includes(row.name)) {
        throw new BadRequestException(
          `Невідома роль: ${row.name}. Допустимі: ${ROLE_NAMES.join(', ')}`,
        );
      }
    }

    const nonAdmin = items.filter((r) => !r.isAdminRole);
    const tierRows = nonAdmin.filter((r) => isPrimaryTierName(r.name));
    if (tierRows.length > 1) {
      throw new BadRequestException(
        'Не більше одного рядка з базовою роллю (Гість / Гравець / Медіа)',
      );
    }

    const captainCount = nonAdmin.filter((r) => r.name === Role.CAPTAIN).length;
    if (captainCount > 1) {
      throw new BadRequestException('Не більше одного призначення «Капітан»');
    }

    const adminRows = items.filter((r) => r.isAdminRole);
    if (adminRows.length > 1) {
      throw new BadRequestException('Не більше одного адмінського призначення');
    }
    for (const r of adminRows) {
      if (r.name !== Role.ADMIN) {
        throw new BadRequestException(
          'Для isAdminRole: true очікується лише роль «Адмін»',
        );
      }
    }
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

    const refreshed = await this.findPlayerWithRoles(playerId);
    await this.authService.syncPlayerGuildRoles(refreshed);

    return { playerId, isAdmin: true };
  }

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

    const refreshed = await this.findPlayerWithRoles(playerId);
    await this.authService.syncPlayerGuildRoles(refreshed);

    return { playerId, isAdmin: false };
  }

  private async setPrimaryRole(
    playerId: string,
    name: RoleName,
  ): Promise<PlayerRoleResult> {
    const player = await this.findPlayerWithRoles(playerId);

    const nonAdmin = player.roles.filter((r) => !r.isAdminRole);
    const tierRows = nonAdmin.filter((r) => isPrimaryTierName(r.name));

    if (tierRows.length > 1) {
      await this.rolesRepo.remove(tierRows.slice(1));
    }

    let tier = tierRows[0];
    if (!tier) {
      tier = this.rolesRepo.create({
        isAdminRole: false,
      } as DeepPartial<UserRoles>);
      tier.player = player;
    }
    tier.name = name;
    await this.rolesRepo.save(tier);

    if (name === Role.PLAYER || name === Role.GUEST) {
      const newVerifiedAt = name === Role.PLAYER ? new Date() : null;
      await this.dataSource
        .createQueryBuilder()
        .update(Player)
        .set({ verifiedAt: newVerifiedAt })
        .where('id = :playerId', { playerId })
        .execute();
    }

    const refreshed = await this.findPlayerWithRoles(playerId);
    await this.authService.syncPlayerGuildRoles(refreshed);

    return {
      playerId,
      name,
      verifiedAt: refreshed.verifiedAt,
    };
  }

  async unverifyTeam(
    teamId: string,
  ): Promise<{ teamId: string; isVerified: boolean }> {
    const team = await this.teamsRepo.findOne({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');
    team.isVerified = false;
    team.verifiedAt = null;
    await this.teamsRepo.save(team);
    return { teamId, isVerified: false };
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

  async overrideMatchResult(
    matchId: string,
    dto: OverrideMatchResultDto,
  ): Promise<{ matchId: string; winnerId: string }> {
    const matchRepo = this.dataSource.getRepository(QualificationMatch);

    const match = await matchRepo.findOne({
      where: { id: matchId },
      relations: [
        'qualification',
        'qualification.tournament',
        'teamA',
        'teamA.mainPlayers',
        'teamB',
        'teamB.mainPlayers',
      ],
    });
    if (!match) throw new NotFoundException('Match not found');

    if (match.dotaMatchId !== null) {
      throw new ConflictException(
        'Match result already recorded — use a different match or clear the existing result first',
      );
    }

    if (
      dto.winnerTeamId !== match.teamA.id &&
      dto.winnerTeamId !== match.teamB.id
    ) {
      throw new BadRequestException(
        'winnerTeamId must be one of the two teams in this match',
      );
    }

    const tournamentId = match.qualification.tournament.id;
    const winner =
      dto.winnerTeamId === match.teamA.id ? match.teamA : match.teamB;
    const loser =
      dto.winnerTeamId === match.teamA.id ? match.teamB : match.teamA;

    match.winner = winner;
    match.dotaMatchId = `manual_${matchId}`;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(QualificationMatch).save(match);
      await this.awardPoints(
        manager,
        winner.mainPlayers ?? [],
        tournamentId,
        dto.winnerPoints ?? 100,
      );
      await this.awardPoints(
        manager,
        loser.mainPlayers ?? [],
        tournamentId,
        dto.loserPoints ?? 40,
      );
    });

    return { matchId, winnerId: winner.id };
  }

  private async awardPoints(
    manager: EntityManager,
    players: Player[],
    tournamentId: string,
    amount: number,
  ): Promise<void> {
    const repo = manager.getRepository(PlayerTournamentPoints);
    for (const player of players) {
      const existing = await repo.findOne({
        where: { playerId: player.id, tournamentId },
      });
      if (existing) {
        existing.points += amount;
        await repo.save(existing);
      } else {
        await repo.save(
          repo.create({ playerId: player.id, tournamentId, points: amount }),
        );
      }
    }
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
