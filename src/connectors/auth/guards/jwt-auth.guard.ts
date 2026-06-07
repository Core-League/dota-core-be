import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { IJwtAuthGuard } from '../../../types/interfaced/connectors/auth.connector.interface';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') implements IJwtAuthGuard {}
