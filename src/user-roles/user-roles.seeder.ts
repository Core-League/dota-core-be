import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRoles } from './user-roles.entity';

const HARDCODED_ROLES: Array<Pick<UserRoles, 'name' | 'isAdminRole'>> = [
  { name: 'Адмін', isAdminRole: true },
  { name: 'Гість', isAdminRole: false },
  { name: 'Користувач', isAdminRole: false },
];

@Injectable()
export class UserRolesSeeder implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(UserRoles)
    private readonly repo: Repository<UserRoles>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const seed of HARDCODED_ROLES) {
      const exists = await this.repo.findOne({ where: { name: seed.name } });
      if (!exists) {
        await this.repo.save(this.repo.create(seed));
      }
    }
  }
}
