import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  CHAT_RETENTION_CRON,
  CHAT_RETENTION_DAYS,
  CHAT_RETENTION_TIME_ZONE,
} from './chat.constants';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

/**
 * Weekly cleanup of the public chat channels (General, Captains, Duel, VIP):
 * every Sunday at 23:59 Kyiv time, messages older than 7 days are deleted.
 * Admin threads and DMs are kept. Runs in api-v1 only (`ScheduleModule`
 * lives in `AppModule`); connected clients drop the purged messages too.
 */
@Injectable()
export class ChatRetentionScheduler {
  private readonly logger = new Logger(ChatRetentionScheduler.name);

  private isRunning = false;

  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Cron(CHAT_RETENTION_CRON, {
    name: 'chat-retention',
    timeZone: CHAT_RETENTION_TIME_ZONE,
  })
  async purgePublicChannels(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const { deleted, before } = await this.chat.purgeOldPublicMessages();
      this.logger.log(
        `chat retention: deleted ${deleted} public message(s) older than ${CHAT_RETENTION_DAYS} days (before ${before.toISOString()})`,
      );
      this.gateway.broadcastPurge(before);
    } catch (err) {
      this.logger.error(
        'chat retention purge failed; next Sunday retries',
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
