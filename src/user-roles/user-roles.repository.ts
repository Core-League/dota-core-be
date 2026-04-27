import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserRoles } from './user-roles.entity';

@Injectable()
export class UserRolesRepository {
  private readonly repo: Repository<UserRoles>;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.repo = dataSource.getRepository(UserRoles);
  }

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
