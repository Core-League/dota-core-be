import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UserRoles } from './user-roles.entity';
import {
  getRoleColorByName,
  getSystemCatalogRoleSpec,
  ROLE_CATALOG_DISPLAY_ORDER,
  ROLE_NAMES,
} from './role.constants';
import { UserRolesRepository } from './user-roles.repository';
import { UserRoleResponseDto } from './dto/user-role-response.dto';
import { CreateUserRoleDto } from './dto/create-user-role.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { Player } from '../players/player.entity';

@Injectable()
export class UserRolesService {
  constructor(private readonly userRolesRepo: UserRolesRepository) {}

  private toResponse(role: UserRoles): UserRoleResponseDto {
    return {
      id: role.id,
      name: role.name,
      isAdminRole: role.isAdminRole,
      color: getRoleColorByName(role.name) ?? '#64748B',
    };
  }

  private assertAllowedRoleName(name: string | undefined): void {
    if (name === undefined) return;
    if (!(ROLE_NAMES as readonly string[]).includes(name)) {
      throw new BadRequestException(
        `name must be one of: ${ROLE_NAMES.join(', ')}`,
      );
    }
  }

  async create(
    playerId: string,
    body: CreateUserRoleDto,
  ): Promise<UserRoleResponseDto> {
    this.assertAllowedRoleName(body.name);
    const entity = this.userRolesRepo.create({
      name: body.name,
      isAdminRole: body.isAdminRole,
      player: { id: playerId } as Player,
    });
    const saved = await this.userRolesRepo.save(entity);
    return this.toResponse(saved);
  }

  async findAll(): Promise<UserRoleResponseDto[]> {
    const rows = await this.userRolesRepo.findAllCatalog();
    const byId = new Map(rows.map((r) => [r.id, r]));

    const merged = ROLE_CATALOG_DISPLAY_ORDER.map((id) => {
      const existing = byId.get(id);
      if (existing) {
        return existing;
      }
      const spec = getSystemCatalogRoleSpec(id);
      if (!spec) {
        throw new InternalServerErrorException(
          `Missing catalog spec for role id ${id}`,
        );
      }
      return this.userRolesRepo.create({
        id,
        name: spec.name,
        isAdminRole: spec.isAdminRole,
        player: null,
      });
    });
    return merged.map((r) => this.toResponse(r));
  }

  async findOne(id: string): Promise<UserRoleResponseDto> {
    const role = await this.userRolesRepo.findOneById(id);
    if (!role) {
      throw new NotFoundException('Роль користувача не знайдено');
    }
    return this.toResponse(role);
  }

  async update(
    id: string,
    payload: UpdateUserRoleDto,
  ): Promise<UserRoleResponseDto> {
    const role = await this.userRolesRepo.findOneById(id);
    if (!role) {
      throw new NotFoundException('Роль користувача не знайдено');
    }
    if (role.player == null) {
      throw new ForbiddenException('Системні ролі не можна змінювати');
    }
    this.assertAllowedRoleName(payload.name);
    if (payload.name !== undefined) role.name = payload.name;
    if (payload.isAdminRole !== undefined)
      role.isAdminRole = payload.isAdminRole;
    const saved = await this.userRolesRepo.save(role);
    return this.toResponse(saved);
  }

  async remove(id: string): Promise<void> {
    const role = await this.userRolesRepo.findOneById(id);
    if (!role) {
      throw new NotFoundException('Роль користувача не знайдено');
    }
    if (role.player == null) {
      throw new ForbiddenException('Системні ролі не можна видаляти');
    }
    await this.userRolesRepo.remove(role);
  }
}
