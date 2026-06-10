import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

/** Subset of the v1-owned `player` row that the verification flow needs. */
export interface VerificationPlayer {
  id: string;
  rating: number;
  verifiedAt: Date | null;
}

interface PlayerRow {
  id: string;
  rating: number | string;
  verifiedAt: Date | string | null;
}

/**
 * Read/write access to the **v1-owned** `player` table from v2. Reads use raw
 * SQL (same rationale as {@link TeamRepository}); the completion write updates
 * `rating`/`verifiedAt` directly on the shared DB — the one place v2 crosses the
 * v1 ownership boundary, kept isolated here.
 */
@Injectable()
export class PlayerRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findByIds(ids: string[]): Promise<VerificationPlayer[]> {
    if (ids.length === 0) return [];
    const rows = await this.dataSource.query<PlayerRow[]>(
      `SELECT "id", "rating", "verifiedAt" FROM "player" WHERE "id" = ANY($1)`,
      [ids],
    );
    return rows.map((r) => ({
      id: r.id,
      rating: Number(r.rating),
      verifiedAt: r.verifiedAt ? new Date(r.verifiedAt) : null,
    }));
  }

  /**
   * Write MMR results to v1 `player`. Always updates `rating`; for a FIRST
   * verification also stamps `verifiedAt` where it is still null. Runs inside the
   * provided transaction manager when given.
   */
  async applyResults(
    updates: { playerId: string; mmr: number }[],
    markVerified: boolean,
    manager?: EntityManager,
  ): Promise<void> {
    const runner = manager ?? this.dataSource.manager;
    for (const u of updates) {
      await runner.query(
        markVerified
          ? `UPDATE "player" SET "rating" = $2, "verifiedAt" = COALESCE("verifiedAt", now()) WHERE "id" = $1`
          : `UPDATE "player" SET "rating" = $2 WHERE "id" = $1`,
        [u.playerId, u.mmr],
      );
    }
  }
}
