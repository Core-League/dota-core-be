import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, DeepPartial, Repository } from 'typeorm';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import {
  getRoleColorByName,
  Role,
  RoleName,
  ROLE_NAMES,
} from '../user-roles/role.constants';
import { AuthService } from '../auth/auth.service';
import {
  AdminPlayerRoleItemDto,
  AdminSetPlayerRolesDto,
} from './dto/admin-set-player-roles.dto';

const TIER_ROLE_NAMES = new Set<RoleName>([Role.GUEST, Role.PLAYER]);

export type VerifyResult = {
  playerId: string;
  verified: boolean;
  verifiedAt: Date | null;
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

function isTierRoleName(name: string): boolean {
  return TIER_ROLE_NAMES.has(name as RoleName);
}

@Injectable()
export class AdminService {
  private readonly playersRepo: Repository<Player>;
  private readonly rolesRepo: Repository<UserRoles>;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly authService: AuthService,
  ) {
    this.playersRepo = dataSource.getRepository(Player);
    this.rolesRepo = dataSource.getRepository(UserRoles);
  }

  /**
   * Замінює всі user_roles гравця та оновлює verifiedAt для узгодженості з «Гість/Гравець».
   * Синхронізує відповідні ролі в Discord (якщо налаштовано env).
   */
  async setPlayerRoles(
    playerId: string,
    dto: AdminSetPlayerRolesDto,
  ): Promise<AdminPlayerRolesResult> {
    const items = dto.roles ?? [];
    this.assertValidRoleAssignmentList(items);

    await this.dataSource.transaction(async (manager) => {
      const players = manager.getRepository(Player);
      const roles = manager.getRepository(UserRoles);

      const player = await players.findOne({
        where: { id: playerId },
        relations: ['roles'],
      });
      if (!player) throw new NotFoundException('Player not found');

      await roles.delete({ player: { id: playerId } });

      for (const row of items) {
        const created = roles.create({
          name: row.name,
          isAdminRole: row.isAdminRole,
          player: { id: playerId } as Player,
        } as DeepPartial<UserRoles>);
        await roles.save(created);
      }

      const hasPlayerTier = items.some(
        (r) => !r.isAdminRole && r.name === Role.PLAYER,
      );
      if (hasPlayerTier) {
        player.verifiedAt = player.verifiedAt ?? new Date();
      } else {
        player.verifiedAt = null;
      }
      await players.save(player);
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
    const tierRows = nonAdmin.filter((r) => isTierRoleName(r.name));
    if (tierRows.length > 1) {
      throw new BadRequestException(
        'Очікується не більше одного рядка з роллю «Гість» або «Гравець»',
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
    const player = await this.findPlayerWithRoles(playerId);

    const nonAdmin = player.roles.filter((r) => !r.isAdminRole);

    const tierRoles = nonAdmin.filter((r) => isTierRoleName(r.name));

    if (tierRoles.length > 1) {
      await this.rolesRepo.remove(tierRoles.slice(1));
    }

    let tier = tierRoles[0];
    if (!tier) {
      tier = this.rolesRepo.create({
        isAdminRole: false,
      } as DeepPartial<UserRoles>);
      tier.player = player;
    }
    tier.name = Role.PLAYER;
    await this.rolesRepo.save(tier);

    player.verifiedAt = new Date();
    await this.playersRepo.save(player);

    const refreshed = await this.findPlayerWithRoles(playerId);
    await this.authService.syncPlayerGuildRoles(refreshed);

    return {
      playerId,
      verified: true,
      verifiedAt: refreshed.verifiedAt,
    };
  }

  async unverifyPlayer(playerId: string): Promise<VerifyResult> {
    const player = await this.findPlayerWithRoles(playerId);

    const nonAdmin = player.roles.filter((r) => !r.isAdminRole);
    const tierRoles = nonAdmin.filter((r) => isTierRoleName(r.name));
    const auxiliaryRoles = nonAdmin.filter((r) => !isTierRoleName(r.name));

    if (tierRoles.length > 1) {
      await this.rolesRepo.remove(tierRoles.slice(1));
    }

    const tier = tierRoles[0];
    if (tier) {
      tier.name = Role.GUEST;
      await this.rolesRepo.save(tier);
    } else if (auxiliaryRoles.length > 0) {
      const guest = this.rolesRepo.create({
        name: Role.GUEST,
        isAdminRole: false,
        player,
      } as DeepPartial<UserRoles>);
      await this.rolesRepo.save(guest);
    }

    player.verifiedAt = null;
    await this.playersRepo.save(player);

    const refreshed = await this.findPlayerWithRoles(playerId);
    await this.authService.syncPlayerGuildRoles(refreshed);

    return {
      playerId,
      verified: false,
      verifiedAt: null,
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
