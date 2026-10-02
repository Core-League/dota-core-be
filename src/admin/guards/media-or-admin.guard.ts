import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Player } from '../../players/player.entity';
import { Role } from '../../user-roles/role.constants';

/** Like `AdminGuard`, but also lets media staff («Медіа») through. */
@Injectable()
export class MediaOrAdminGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { playerId: string } }>();
    const playerId = req.user?.playerId;
    if (!playerId) return false;

    const player = await this.dataSource.getRepository(Player).findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    if (!player) return false;

    const allowed = (player.roles ?? []).some(
      (r) => r.isAdminRole || r.name === Role.MEDIA,
    );
    if (!allowed)
      throw new ForbiddenException('Media or admin access required');
    return true;
  }
}
