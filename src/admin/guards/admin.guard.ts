import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Player } from '../../players/player.entity';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { playerId: string } }>();
    const playerId = req.user?.playerId;
    if (!playerId) return false;

    const playersRepo = this.dataSource.getRepository(Player);
    const player = await playersRepo.findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    if (!player) return false;

    const isAdmin = (player.roles ?? []).some((r) => r.isAdminRole);
    if (!isAdmin) throw new ForbiddenException('Admin access required');
    return true;
  }
}
