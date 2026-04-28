import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { Player } from '../../players/player.entity';

export type RequestWithJwtActor = Request & {
  user?: { playerId: string };
  actorHasAdminRole?: boolean;
};

/**
 * JWT subject must equal route `:id` (own profile), or the caller must have an admin-type role on any of their roles.
 */
@Injectable()
export class OwnPlayerOrAdminGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithJwtActor>();
    const jwtPlayerId = req.user?.playerId;
    const routePlayerId = req.params?.id;
    if (!jwtPlayerId || !routePlayerId) {
      throw new ForbiddenException(
        'You can only change your own player profile',
      );
    }

    const admin = await this.actorHasAdminRole(jwtPlayerId);
    req.actorHasAdminRole = admin;

    if (jwtPlayerId === routePlayerId) {
      return true;
    }
    if (admin) {
      return true;
    }
    throw new ForbiddenException('You can only change your own player profile');
  }

  private async actorHasAdminRole(playerId: string): Promise<boolean> {
    const row = await this.dataSource.getRepository(Player).findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    return (row?.roles ?? []).some((r) => r.isAdminRole);
  }
}
