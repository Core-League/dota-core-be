import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Player } from '../player.entity';

@Injectable()
export class SelfOrAdminGuard implements CanActivate {
  constructor(
    @InjectRepository(Player)
    private readonly playersRepo: Repository<Player>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      user?: { playerId: string };
      params?: { id: string };
    }>();
    const currentPlayerId = req.user?.playerId;
    const targetPlayerId = req.params?.id;

    if (!currentPlayerId) return false;
    if (currentPlayerId === targetPlayerId) return true;

    const player = await this.playersRepo.findOne({
      where: { id: currentPlayerId },
      relations: ['roles'],
    });
    if (!player) return false;

    const isAdmin = (player.roles ?? []).some((r) => r.isAdminRole);
    if (!isAdmin) throw new ForbiddenException('Можна редагувати лише власний профіль');
    return true;
  }
}
