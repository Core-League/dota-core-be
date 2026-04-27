import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/** Route param must be `:id` (UUID of the player). JWT subject must match. */
@Injectable()
export class OwnPlayerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { playerId: string }; params?: { id?: string } }>();
    const jwtPlayerId = req.user?.playerId;
    const routePlayerId = req.params?.id;
    if (!jwtPlayerId || !routePlayerId || jwtPlayerId !== routePlayerId) {
      throw new ForbiddenException(
        'You can only change your own player profile',
      );
    }
    return true;
  }
}
