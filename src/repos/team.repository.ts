import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Team } from '../types/entities/finance/team';
import type { ITeamRepository } from '../types/interfaced/repos/team.repository.interface';

interface TeamRow {
  id: string;
  name: string;
  logoUrl: string | null;
}

/**
 * Read-only access to the v1-owned `team` table.
 *
 * TODO: replace this raw query with a proper TypeORM model + repository once the
 * `teams` domain migrates into v2 and v2 owns the table. Until then v1 owns
 * `team`, and registering v1's `Team` entity here would drag its whole relation
 * graph (Player/Tournament/Match/…) into v2's connection — so we read the three
 * columns we need directly instead.
 */
@Injectable()
export class TeamRepository implements ITeamRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Match case-insensitively and trim, since the key comes from a parsed comment. */
  async findByName(name: string): Promise<Team | null> {
    const rows = await this.dataSource.query<TeamRow[]>(
      `SELECT "id", "name", "logoUrl"
       FROM "team"
       WHERE LOWER(TRIM("name")) = LOWER(TRIM($1))
       LIMIT 1`,
      [name],
    );
    const row = rows[0];
    return row ? { id: row.id, name: row.name, avatarRef: row.logoUrl } : null;
  }
}
