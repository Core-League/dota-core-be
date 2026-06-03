import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { IJwtAuthGuard } from '../../../types/interfaced/connectors/auth.connector.interface';
import { Observable } from 'rxjs';

@Injectable()
// export class JwtAuthGuard extends AuthGuard('jwt') implements IJwtAuthGuard { }
export class JwtAuthGuard implements IJwtAuthGuard {
  canActivate() {
    return true;
  }
}
