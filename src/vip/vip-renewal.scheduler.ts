import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VipService } from './vip.service';

/**
 * Charges saved cards for VIP renewals. Claims are atomic in the DB
 * (`vip_subscription.renewalClaimedAt`), so an overlapping tick or a second
 * process cannot charge a card twice for the same period.
 */
@Injectable()
export class VipRenewalScheduler {
  private readonly logger = new Logger(VipRenewalScheduler.name);

  private isRunning = false;

  constructor(private readonly vip: VipService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async chargeDueRenewals(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await this.vip.runDueRenewals();
    } catch (err) {
      this.logger.error(
        'VIP renewal sweep failed; the next tick retries',
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
