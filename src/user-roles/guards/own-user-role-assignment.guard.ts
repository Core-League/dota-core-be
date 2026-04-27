import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserRoles } from '../user-roles.entity';

/**
 * Route param `:id` is a `user_roles` row. JWT subject must own that assignment
 * (not system catalog rows).
 */
@Injectable()
export class OwnUserRoleAssignmentGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      user?: { playerId: string };
      params?: { id?: string };
    }>();
    const jwtPlayerId = req.user?.playerId;
    const roleId = req.params?.id;
    if (!jwtPlayerId || !roleId) {
      throw new ForbiddenException('Потрібна авторизація');
    }

    const role = await this.dataSource.getRepository(UserRoles).findOne({
      where: { id: roleId },
      relations: ['player'],
    });
    if (!role) {
      throw new NotFoundException('Роль користувача не знайдено');
    }
    if (role.player == null) {
      throw new ForbiddenException(
        'Системні ролі недоступні для цієї операції',
      );
    }
    if (role.player.id !== jwtPlayerId) {
      throw new ForbiddenException('Можна змінювати лише власні ролі');
    }
    return true;
  }
}
