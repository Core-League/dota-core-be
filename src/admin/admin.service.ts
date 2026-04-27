import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, DeepPartial, Repository } from 'typeorm';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { Role } from '../user-roles/role.constants';

export type VerifyResult = {
  playerId: string;
  verified: boolean;
  verifiedAt: Date | null;
};

@Injectable()
export class AdminService {
  private readonly playersRepo: Repository<Player>;
  private readonly rolesRepo: Repository<UserRoles>;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.playersRepo = dataSource.getRepository(Player);
    this.rolesRepo = dataSource.getRepository(UserRoles);
  }

  async verifyPlayer(playerId: string): Promise<VerifyResult> {
    const player = await this.findPlayerWithRoles(playerId);

    let role = player.roles.find((r) => !r.isAdminRole);
    if (!role) {
      role = this.rolesRepo.create({
        isAdminRole: false,
      } as DeepPartial<UserRoles>);
      role.player = player;
    }
    role.name = Role.USER;
    await this.rolesRepo.save(role);

    player.verifiedAt = new Date();
    await this.playersRepo.save(player);

    return { playerId, verified: true, verifiedAt: player.verifiedAt };
  }

  async unverifyPlayer(playerId: string): Promise<VerifyResult> {
    const player = await this.findPlayerWithRoles(playerId);

    const role = player.roles.find((r) => !r.isAdminRole);
    if (role) {
      role.name = Role.GUEST;
      await this.rolesRepo.save(role);
    }

    player.verifiedAt = null;
    await this.playersRepo.save(player);

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
}
