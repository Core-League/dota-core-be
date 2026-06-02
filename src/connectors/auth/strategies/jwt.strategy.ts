import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigConnectorService } from '../../config/config-connector.service';

export type JwtPayload = { sub: string; typ?: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigConnectorService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getEnvConfig().JWT_SECRET,
    });
  }

  validate(payload: JwtPayload): { playerId: string } {
    return { playerId: payload.sub };
  }
}
