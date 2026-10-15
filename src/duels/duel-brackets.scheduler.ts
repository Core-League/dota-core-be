import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DUEL_BRACKET_SWEEP_MS } from './duel.constants';
import { DuelBracketsService } from './duel-brackets.service';

/**
 * Safety net of the bracket engine (api-v1 only): duel events normally move
 * the brackets on, this sweep catches what they missed — a listener outage,
 * a ready match whose player was busy in another duel — and settles the
 * prizes of finished brackets.
 */
@Injectable()
export class DuelBracketsScheduler {
  private readonly logger = new Logger(DuelBracketsScheduler.name);
  private running = false;

  constructor(private readonly brackets: DuelBracketsService) {}

  @Interval(DUEL_BRACKET_SWEEP_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.brackets.sweep();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Bracket sweep failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
