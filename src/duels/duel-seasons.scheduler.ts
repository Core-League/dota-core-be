import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DUEL_SEASON_SWEEP_MS } from './duel.constants';
import { DuelSeasonsService } from './duel-seasons.service';

/**
 * Ends the ladder season once its month is over and retries settling the
 * prizes of ended seasons (api-v1 only — VIP is granted through
 * `VipService`). Every step is claimed with a conditional update, so an
 * overlapping run can never roll over or grant twice.
 */
@Injectable()
export class DuelSeasonsScheduler {
  private readonly logger = new Logger(DuelSeasonsScheduler.name);
  private running = false;

  constructor(private readonly seasons: DuelSeasonsService) {}

  @Interval(DUEL_SEASON_SWEEP_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.seasons.sweep();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Duel season sweep failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
