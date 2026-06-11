import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Resolves the calling player's id. Prefers the JWT-populated `req.user.playerId`
 * (once `JwtAuthGuard` is enabled); falls back to an `x-player-id` header so the
 * flow is exercisable while the v2 auth guards are still stubbed open.
 */
export const CurrentPlayerId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<{
      user?: { playerId?: string };
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = req.headers['x-player-id'];
    const playerId =
      req.user?.playerId ?? (Array.isArray(header) ? header[0] : header);
    if (!playerId) {
      throw new UnauthorizedException('Player identity required');
    }
    return playerId;
  },
);
