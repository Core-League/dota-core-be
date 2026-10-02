import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecruitmentService } from './recruitment.service';

/**
 * Every 10 minutes: expire overdue applications / invites and drop the
 * requests and listings of players who joined a team some other way.
 * Runs in api-v1 only (`ScheduleModule` lives in `AppModule`).
 */
@Injectable()
export class RecruitmentScheduler {
  private readonly logger = new Logger(RecruitmentScheduler.name);

  private isRunning = false;

  constructor(private readonly recruitment: RecruitmentService) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'recruitment-sweep' })
  async sweep(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await this.recruitment.sweep();
    } catch (e) {
      this.logger.error(`recruitment sweep failed: ${String(e)}`);
    } finally {
      this.isRunning = false;
    }
  }
}
