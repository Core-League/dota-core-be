import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Player } from '../../players/player.entity';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @InjectRepository(Player)
    private readonly playersRepo: Repository<Player>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: { playerId: string } }>();
    const playerId = req.user?.playerId;
    if (!playerId) return false;

    const player = await this.playersRepo.findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    if (!player) return false;

    const isAdmin = (player.roles ?? []).some((r) => r.isAdminRole);
    if (!isAdmin) throw new ForbiddenException('Доступ лише для адміністраторів');
    return true;
  }
}
