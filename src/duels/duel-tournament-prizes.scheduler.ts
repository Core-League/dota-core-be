import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DUEL_TOURNAMENT_PRIZES_SWEEP_MS } from './duel.constants';
import { DuelTournamentsService } from './duel-tournaments.service';

/**
 * Settles the prizes of ended tournaments whose last games were still running
 * at the end (api-v1 only — VIP is granted through `VipService`). Settling is
 * claimed per tournament, so an overlapping run can never grant twice.
 */
@Injectable()
export class DuelTournamentPrizesScheduler {
  private readonly logger = new Logger(DuelTournamentPrizesScheduler.name);
  private running = false;

  constructor(private readonly tournaments: DuelTournamentsService) {}

  @Interval(DUEL_TOURNAMENT_PRIZES_SWEEP_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tournaments.settleDuePrizes();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Tournament prizes sweep failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
