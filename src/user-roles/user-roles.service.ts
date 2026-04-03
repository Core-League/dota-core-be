import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRoles } from './user-roles.entity';
import { UserRolesRepository } from './user-roles.repository';

@Injectable()
export class UserRolesService {
  constructor(private readonly userRolesRepo: UserRolesRepository) {}

  create(payload: Partial<UserRoles>): Promise<UserRoles> {
    const entity = this.userRolesRepo.create(payload);
    return this.userRolesRepo.save(entity);
  }

  findAll(): Promise<UserRoles[]> {
    return this.userRolesRepo.findAll();
  }

  async findOne(id: string): Promise<UserRoles> {
    const role = await this.userRolesRepo.findOneById(id);
    if (!role) {
      throw new NotFoundException('Роль користувача не знайдено');
    }
    return role;
  }

  async update(id: string, payload: Partial<UserRoles>): Promise<UserRoles> {
    const role = await this.findOne(id);
    Object.assign(role, payload);
    return this.userRolesRepo.save(role);
  }

  async remove(id: string): Promise<void> {
    const role = await this.findOne(id);
    await this.userRolesRepo.remove(role);
  }
}
