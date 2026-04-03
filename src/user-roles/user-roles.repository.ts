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
    return this.repo.find({ relations: ['player', 'tournaments'] });
  }

  findOneById(id: string): Promise<UserRoles | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['player', 'tournaments'],
    });
  }

  remove(role: UserRoles): Promise<UserRoles> {
    return this.repo.remove(role);
  }
}
