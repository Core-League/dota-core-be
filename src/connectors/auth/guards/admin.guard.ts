import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { IAdminGuard } from '../../../types/interfaced/connectors/auth.connector.interface';

@Injectable()
export class AdminGuard implements CanActivate, IAdminGuard {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { playerId: string } }>();
    const playerId = req.user?.playerId;
    if (!playerId) return false;

    const rows = await this.dataSource.query<unknown[]>(
      `SELECT 1 FROM user_roles WHERE "playerId" = $1 AND "isAdminRole" = true LIMIT 1`,
      [playerId],
    );

    if (!rows.length) throw new ForbiddenException('Admin access required');
    return true;
  }
}
