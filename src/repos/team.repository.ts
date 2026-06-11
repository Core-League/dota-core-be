import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import type { Team } from '../types/entities/finance/team';
import type { VerificationTeam } from '../types/entities/verification/request';
import type { ITeamRepository } from '../types/interfaced/repos/team.repository.interface';

interface TeamRow {
  id: string;
  name: string;
  logoUrl: string | null;
}

/** Every own column of the v1 `team` row (timestamps arrive as Date from pg). */
interface VerificationTeamRow {
  id: string;
  name: string;
  logoUrl: string | null;
  dotaTeamId: string | null;
  discordRoleId: string | null;
  discordChannelId: string | null;
  isVerified: boolean;
  isPlayingTournament: boolean;
  captainId: string;
  coachId: string | null;
  verifiedAt: Date | null;
  disbandedAt: Date | null;
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

  /** Full team row for one id (embedded in a verification request view). */
  async findFullById(teamId: string): Promise<VerificationTeam | null> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('team.*')
      .from('team', 'team')
      .where('team.id = :teamId', { teamId })
      .limit(1)
      .getRawOne<VerificationTeamRow>();
    return row ? toVerificationTeam(row) : null;
  }

  /** Batch full-team lookup for the admin daily list, keyed by id. */
  async findFullByIds(ids: string[]): Promise<Map<string, VerificationTeam>> {
    if (ids.length === 0) return new Map();
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('team.*')
      .from('team', 'team')
      .where('team.id IN (:...ids)', { ids })
      .getRawMany<VerificationTeamRow>();
    return new Map(rows.map((r) => [r.id, toVerificationTeam(r)]));
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

function toVerificationTeam(row: VerificationTeamRow): VerificationTeam {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logoUrl,
    dotaTeamId: row.dotaTeamId,
    discordRoleId: row.discordRoleId,
    discordChannelId: row.discordChannelId,
    isVerified: row.isVerified,
    isPlayingTournament: row.isPlayingTournament,
    captainId: row.captainId,
    coachId: row.coachId,
    verifiedAt: row.verifiedAt,
    disbandedAt: row.disbandedAt,
  };
}
