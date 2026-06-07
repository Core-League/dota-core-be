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
 * Read-only raw access to the v1-owned `team` table. Registering v1's `Team` entity
 * would drag its whole relation graph (Player/Tournament/Match/…) into v2's
 * connection, so we read the columns we need directly.
 * TODO: replace with a TypeORM model once the `teams` domain migrates to v2.
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
    return row ? toTeam(row) : null;
  }

  /** Whole team catalog, for matching many comments in memory in one pass. */
  async findAll(): Promise<Team[]> {
    const rows = await this.dataSource.query<TeamRow[]>(
      `SELECT "id", "name", "logoUrl" FROM "team"`,
    );
    return rows.map(toTeam);
  }
}

function toTeam(row: TeamRow): Team {
  return { id: row.id, name: row.name, avatarRef: row.logoUrl };
}
