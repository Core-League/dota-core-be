import {
  BadRequestException,
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
  ADMIN_ROLE_NAMES,
  getRoleColorByName,
  isAdminRoleName,
  Role,
  RoleName,
  ROLE_NAMES,
} from '../user-roles/role.constants';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import { QualificationMatch } from '../qualification/qualification-match.entity';
import { PlayoffMatch } from '../playoff/playoff-match.entity';
import { DiscordBotService } from '../discord/discord-bot.service';
import { OverrideMatchResultDto } from './dto/override-match-result.dto';
import { AuthService } from '../auth/auth.service';
import { Dota2Service } from '../dota2/dota2.service';
import {
  AdminPlayerRoleItemDto,
  AdminSetPlayerRolesDto,
} from './dto/admin-set-player-roles.dto';

/**
 * «Базові» ролі: Гість / Гравець / Медіа. Гравець і Медіа можуть бути разом;
 * Гість — лише сам (означає «без базової ролі»). Капітан — окремий рядок, не чіпаємо тут.
 */
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
    private readonly dota2: Dota2Service,
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

      // «Адмін» / «IT» верифіковані автоматично — базова роль «Гравець» їм не потрібна.
      const isVerifiedByRoles = items.some(
        (r) =>
          (!r.isAdminRole && r.name === Role.PLAYER) || isAdminRoleName(r.name),
      );
      const newVerifiedAt = isVerifiedByRoles
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

    const names = items.map((r) => r.name);
    if (new Set(names).size !== names.length) {
      throw new BadRequestException(
        'Список ролей містить дублікати — кожна роль може зустрічатися лише один раз',
      );
    }

    const nonAdmin = items.filter((r) => !r.isAdminRole);
    const tierRows = nonAdmin.filter((r) => isPrimaryTierName(r.name));
    if (tierRows.length > 1 && tierRows.some((r) => r.name === Role.GUEST)) {
      throw new BadRequestException(
        'Роль «Гість» не поєднується з «Гравець» / «Медіа»',
      );
    }

    const captainCount = nonAdmin.filter((r) => r.name === Role.CAPTAIN).length;
    if (captainCount > 1) {
      throw new BadRequestException('Не більше одного призначення «Капітан»');
    }

    // «Адмін» та «IT» мають однакові права; прапор має збігатися з назвою,
    // інакше роль показувалась би без прав (або права — під чужою назвою).
    for (const r of items) {
      if (r.isAdminRole !== isAdminRoleName(r.name)) {
        throw new BadRequestException(
          `isAdminRole: true допустимий лише для ролей ${ADMIN_ROLE_NAMES.join(' / ')}`,
        );
      }
    }
  }

  async verifyPlayer(playerId: string): Promise<VerifyResult> {
    const result = await this.setPrimaryRole(playerId, Role.PLAYER);
    const captainTeam = await this.teamsRepo.findOne({
      where: { captain: { id: playerId }, isVerified: true },
      relations: ['captain'],
    });
    if (captainTeam?.captain?.steamId) {
      void this.dota2.addLeagueAdmin(captainTeam.captain.steamId);
    }
    return {
      playerId: result.playerId,
      verified: true,
      verifiedAt: result.verifiedAt,
    };
  }

  async unverifyPlayer(playerId: string): Promise<VerifyResult> {
    const result = await this.revokePlayerTier(playerId);
    const captainTeam = await this.teamsRepo.findOne({
      where: { captain: { id: playerId }, isVerified: true },
      relations: ['captain'],
    });
    if (captainTeam?.captain?.steamId) {
      void this.dota2.revokeLeagueAdmin(captainTeam.captain.steamId);
    }
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

    // Адмін верифікований автоматично.
    if (!player.verifiedAt) {
      await this.dataSource
        .createQueryBuilder()
        .update(Player)
        .set({ verifiedAt: new Date() })
        .where('id = :playerId', { playerId })
        .execute();
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

    // Гість витісняє Гравця / Медіа; Гравець / Медіа витісняють лише Гостя
    // і співіснують між собою. Дублікати тієї самої ролі теж прибираємо.
    const keep = tierRows.find((r) => r.name === name);
    const toRemove = tierRows.filter(
      (r) =>
        r !== keep &&
        (name === Role.GUEST || r.name === Role.GUEST || r.name === name),
    );
    if (toRemove.length > 0) {
      await this.rolesRepo.remove(toRemove);
    }
    if (!keep) {
      const tier = this.rolesRepo.create({
        name,
        isAdminRole: false,
      } as DeepPartial<UserRoles>);
      tier.player = player;
      await this.rolesRepo.save(tier);
    }

    // «Гість» знімає верифікацію, але не з адміна / IT — вони верифіковані автоматично.
    const hasAdminRole = player.roles.some((r) => isAdminRoleName(r.name));
    if (name === Role.PLAYER || (name === Role.GUEST && !hasAdminRole)) {
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

  /**
   * Знімає лише «Гравець»: «Медіа» лишається; якщо базових ролей не лишилось — «Гість».
   * verifiedAt очищається (крім адміна / IT — вони верифіковані автоматично).
   */
  private async revokePlayerTier(playerId: string): Promise<PlayerRoleResult> {
    const player = await this.findPlayerWithRoles(playerId);
    const tierRows = player.roles.filter(
      (r) => !r.isAdminRole && isPrimaryTierName(r.name),
    );
    const remaining = tierRows.filter((r) => r.name !== Role.PLAYER);
    if (remaining.length === 0) {
      return this.setPrimaryRole(playerId, Role.GUEST);
    }

    const playerRows = tierRows.filter((r) => r.name === Role.PLAYER);
    if (playerRows.length > 0) {
      await this.rolesRepo.remove(playerRows);
    }
    const hasAdminRole = player.roles.some((r) => isAdminRoleName(r.name));
    if (!hasAdminRole) {
      await this.dataSource
        .createQueryBuilder()
        .update(Player)
        .set({ verifiedAt: null })
        .where('id = :playerId', { playerId })
        .execute();
    }

    const refreshed = await this.findPlayerWithRoles(playerId);
    await this.authService.syncPlayerGuildRoles(refreshed);

    return {
      playerId,
      name: remaining[0].name as RoleName,
      verifiedAt: refreshed.verifiedAt,
    };
  }

  async unverifyTeam(
    teamId: string,
  ): Promise<{ teamId: string; isVerified: boolean }> {
    const team = await this.teamsRepo.findOne({
      where: { id: teamId },
      relations: ['captain'],
    });
    if (!team) throw new NotFoundException('Team not found');
    team.isVerified = false;
    team.verifiedAt = null;
    await this.teamsRepo.save(team);
    if (team.captain?.steamId) {
      void this.dota2.revokeLeagueAdmin(team.captain.steamId);
    }
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
        channelId = await this.discord.createTeamVoiceChannel(
          team.name,
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
        'winner',
      ],
    });
    if (!match) throw new NotFoundException('Match not found');

    if (!match.teamA || !match.teamB) {
      throw new BadRequestException(
        'Match is missing one or both sides — team rows may have been deleted',
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
    const newWinner =
      dto.winnerTeamId === match.teamA.id ? match.teamA : match.teamB;
    const newLoser =
      dto.winnerTeamId === match.teamA.id ? match.teamB : match.teamA;

    // Capture old state before modification (for point reversal).
    // Use teamA/teamB (which have mainPlayers loaded) rather than match.winner
    // (which is loaded without the mainPlayers sub-relation).
    const wasAlreadyPlayed =
      match.dotaMatchId !== null && match.winner !== null;
    const oldWinnerId = wasAlreadyPlayed ? match.winner!.id : null;
    const oldWinner =
      oldWinnerId != null
        ? match.teamA.id === oldWinnerId
          ? match.teamA
          : match.teamB
        : null;
    const oldLoser =
      oldWinnerId != null
        ? match.teamA.id === oldWinnerId
          ? match.teamB
          : match.teamA
        : null;

    match.winner = newWinner;
    match.dotaMatchId = `tech_loss_${matchId}`;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(QualificationMatch).save(match);

      if (wasAlreadyPlayed && oldWinner && oldLoser) {
        await this.deductPoints(
          manager,
          oldWinner.mainPlayers ?? [],
          tournamentId,
          dto.winnerPoints ?? 100,
        );
        await this.deductPoints(
          manager,
          oldLoser.mainPlayers ?? [],
          tournamentId,
          dto.loserPoints ?? 40,
        );
      }

      await this.awardPoints(
        manager,
        newWinner.mainPlayers ?? [],
        tournamentId,
        dto.winnerPoints ?? 100,
      );
      await this.awardPoints(
        manager,
        newLoser.mainPlayers ?? [],
        tournamentId,
        dto.loserPoints ?? 40,
      );
    });

    return { matchId, winnerId: newWinner.id };
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

  private async deductPoints(
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
        existing.points = Math.max(0, existing.points - amount);
        await repo.save(existing);
      }
    }
  }

  async overridePlayoffMatchResult(
    matchId: string,
    dto: OverrideMatchResultDto,
  ): Promise<{ matchId: string; winnerId: string }> {
    const matchRepo = this.dataSource.getRepository(PlayoffMatch);

    const match = await matchRepo.findOne({
      where: { id: matchId },
      relations: ['teamA', 'teamB'],
    });
    if (!match) throw new NotFoundException('Playoff match not found');

    if (!match.teamA || !match.teamB) {
      throw new BadRequestException(
        'Match is missing one or both sides — team rows may have been deleted',
      );
    }

    if (
      dto.winnerTeamId !== match.teamAId &&
      dto.winnerTeamId !== match.teamBId
    ) {
      throw new BadRequestException(
        'winnerTeamId must be one of the two teams in this match',
      );
    }

    match.winnerId = dto.winnerTeamId;
    match.isVerified = false;
    await matchRepo.save(match);

    return { matchId, winnerId: dto.winnerTeamId };
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
