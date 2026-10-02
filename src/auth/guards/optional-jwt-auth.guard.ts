import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like `JwtAuthGuard`, but lets anonymous requests through with
 * `req.user = null` (a missing or invalid token is not an error) — for
 * endpoints that guests may read and logged-in players see more of.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser | false): TUser | null {
    return user || null;
  }
}
