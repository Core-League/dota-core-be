// src/playoff/playoff-teardown.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChallongeService } from '../challonge/challonge.service';
import { Dota2Service } from '../dota2/dota2.service';
import { TournamentPlayoffTeam } from '../tournaments/tournament-playoff-team.entity';
import { PlayoffLeagueFixture } from './playoff-league-fixture.entity';
import { Playoff } from './playoff.entity';

/**
 * External resources a playoff owns outside our DB. Captured before the wipe, because the
 * wipe deletes the rows these ids live in.
 */
export interface PlayoffExternalHandles {
  challongeUrl: string | null;
  shellNodeGroupId: string | null;
  fixtureNodeGroupIds: string[];
}

/** Destroys everything a playoff owns: DB rows first, external resources best-effort after. */
@Injectable()
export class PlayoffTeardownService {
  private readonly logger = new Logger(PlayoffTeardownService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly challonge: ChallongeService,
    private readonly dota2: Dota2Service,
  ) {}

  /**
   * Reads every external handle the playoff owns.
   * MUST run before `wipePlayoffState` — that call deletes the rows holding these ids.
   */
  async captureExternalHandles(
    playoff: Playoff,
  ): Promise<PlayoffExternalHandles> {
    const fixtures = await this.dataSource
      .getRepository(PlayoffLeagueFixture)
      .find({
        where: { playoffId: playoff.id },
        select: ['dotaFixtureNodeGroupId'],
      });

    const fixtureNodeGroupIds = [
      ...new Set(
        fixtures
          .map((f) => (f.dotaFixtureNodeGroupId ?? '').trim())
          .filter((id) => id.length > 0),
      ),
    ];

    return {
      challongeUrl: (playoff.challongeUrl ?? '').trim() || null,
      shellNodeGroupId:
        (playoff.dotaPlayoffContainingNodeGroupId ?? '').trim() || null,
      fixtureNodeGroupIds,
    };
  }

  /**
   * Deletes all DB state a playoff owns, in one transaction:
   * - the `playoff` row — cascades `playoff_series`, `playoff_match` and
   *   `playoff_league_fixture` (their FKs are ON DELETE CASCADE);
   * - the `tournament_playoff_team` rows — clears the participant list *and* every
   *   `isDisqualified` flag, so a restart re-derives participants from a clean slate.
   *
   * Safe to call when no playoff exists: both deletes are no-ops then.
   */
  async wipePlayoffState(tournamentId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Playoff).delete({ tournamentId });
      await manager
        .getRepository(TournamentPlayoffTeam)
        .delete({ tournamentId });
    });
  }

  /**
   * Best-effort cleanup of the *old* Challonge tournament and Dota league node groups.
   * Every failure is logged and swallowed: the replacement bracket is already live when this
   * runs, so a stale external handle must never fail the restart. Fixture groups are removed
   * before the shell that contains them.
   */
  async releaseExternals(handles: PlayoffExternalHandles): Promise<void> {
    if (handles.challongeUrl) {
      try {
        await this.challonge.deleteTournament(handles.challongeUrl);
      } catch (err) {
        this.logger.warn(
          `Failed to delete old Challonge tournament ${handles.challongeUrl} — clean up manually`,
          err,
        );
      }
    }

    if (!this.dota2.isLeagueApiConfigured()) return;

    const nodeGroupIds = [
      ...handles.fixtureNodeGroupIds,
      ...(handles.shellNodeGroupId ? [handles.shellNodeGroupId] : []),
    ];

    for (const nodeGroupId of nodeGroupIds) {
      try {
        await this.dota2.removeNodeGroup(nodeGroupId);
      } catch (err) {
        this.logger.warn(
          `Failed to remove old Dota league node group ${nodeGroupId} — clean up manually`,
          err,
        );
      }
    }
  }
}
