import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRoles } from './user-roles.entity';

@Injectable()
export class UserRolesRepository {
  constructor(
    @InjectRepository(UserRoles)
    private readonly repo: Repository<UserRoles>,
  ) {}

  create(payload: Partial<UserRoles>): UserRoles {
    return this.repo.create(payload);
  }

  save(role: UserRoles): Promise<UserRoles> {
    return this.repo.save(role);
  }

  findAll(): Promise<UserRoles[]> {
    return this.repo.find({ select: { id: true, name: true, isAdminRole: true } });
  }

  findOneById(id: string): Promise<UserRoles | null> {
    return this.repo.findOne({
      where: { id },
      select: { id: true, name: true, isAdminRole: true },
    });
  }

  remove(role: UserRoles): Promise<UserRoles> {
    return this.repo.remove(role);
  }
}
