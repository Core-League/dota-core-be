import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import type { Team } from '../types/entities/finance/team';
import type { ITeamRepository } from '../types/interfaced/repos/team.repository.interface';

interface TeamRow {
  id: string;
  name: string;
  logoUrl: string | null;
}

/** A non-disbanded team captained by a given player. */
export interface CaptainedTeam {
  id: string;
  name: string;
  isVerified: boolean;
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

  /** The active team this player captains, if any (verification flow). */
  async findCaptainedTeam(
    captainPlayerId: string,
  ): Promise<CaptainedTeam | null> {
    const rows = await this.dataSource.query<CaptainedTeam[]>(
      `SELECT "id", "name", "isVerified"
       FROM "team"
       WHERE "captainId" = $1 AND "disbandedAt" IS NULL
       LIMIT 1`,
      [captainPlayerId],
    );
    return rows[0] ?? null;
  }

  /** How many of a team's main players are already verified. */
  async countVerifiedMainPlayers(teamId: string): Promise<number> {
    const rows = await this.dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count
       FROM "team_main_players" tmp
       JOIN "player" p ON p."id" = tmp."playerId"
       WHERE tmp."teamId" = $1 AND p."verifiedAt" IS NOT NULL`,
      [teamId],
    );
    return rows[0]?.count ?? 0;
  }

  async findNameById(teamId: string): Promise<string | null> {
    const rows = await this.dataSource.query<{ name: string }[]>(
      `SELECT "name" FROM "team" WHERE "id" = $1 LIMIT 1`,
      [teamId],
    );
    return rows[0]?.name ?? null;
  }

  /** Batch team-name lookup for the admin daily list. */
  async findNamesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.dataSource.query<{ id: string; name: string }[]>(
      `SELECT "id", "name" FROM "team" WHERE "id" = ANY($1)`,
      [ids],
    );
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Mark a team verified on first successful verification (v1-owned write). */
  async markVerified(teamId: string, manager?: EntityManager): Promise<void> {
    const runner = manager ?? this.dataSource.manager;
    await runner.query(
      `UPDATE "team"
       SET "isVerified" = true,
           "verifiedAt" = COALESCE("verifiedAt", now())
       WHERE "id" = $1`,
      [teamId],
    );
  }
}

function toTeam(row: TeamRow): Team {
  return { id: row.id, name: row.name, avatarRef: row.logoUrl };
}
