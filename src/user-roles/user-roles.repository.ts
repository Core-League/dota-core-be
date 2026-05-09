import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { UserRoles } from './user-roles.entity';
import { ROLE_CATALOG_DISPLAY_ORDER } from './role.constants';

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

  /** System role catalog rows: stable UUIDs from `ROLE_CATALOG_DISPLAY_ORDER` (not `playerId IS NULL`, so Адмін is included even if a row was mis-linked). */
  findAllCatalog(): Promise<UserRoles[]> {
    return this.repo.find({
      where: { id: In([...ROLE_CATALOG_DISPLAY_ORDER]) },
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
