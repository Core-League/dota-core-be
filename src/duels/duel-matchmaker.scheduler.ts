import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DuelMatchmakerService } from './duel-matchmaker.service';

/**
 * Runs the matchmaker every 3 s in the api-v1 process. A tick that is still
 * running when the next interval fires is skipped, so pairing never races
 * with itself (api-v1 is a single process).
 */
@Injectable()
export class DuelMatchmakerScheduler {
  private readonly logger = new Logger(DuelMatchmakerScheduler.name);
  private running = false;

  constructor(private readonly matchmaker: DuelMatchmakerService) {}

  @Interval(3000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.matchmaker.tick();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Matchmaker tick failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
