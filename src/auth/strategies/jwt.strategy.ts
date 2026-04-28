import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecretOrThrow } from '../../config/jwt-env';

export type JwtPayload = { sub: string; typ?: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecretOrThrow(),
    });
  }

  validate(payload: JwtPayload): { playerId: string } {
    return { playerId: payload.sub };
  }
}
