import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IJwtAuthGuard } from 'src/types/interfaced';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') implements IJwtAuthGuard {}
