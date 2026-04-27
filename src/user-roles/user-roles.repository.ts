import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
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

  /** System role catalog only (`playerId` null). */
  findAllCatalog(): Promise<UserRoles[]> {
    return this.repo.find({
      where: { player: IsNull() },
      relations: ['player'],
    });
  }

  findOneById(id: string): Promise<UserRoles | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['player'],
    });
  }

  remove(role: UserRoles): Promise<UserRoles> {
    return this.repo.remove(role);
  }
}
