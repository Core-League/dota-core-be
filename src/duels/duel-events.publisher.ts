import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DUEL_EVENTS_CHANNEL, type DuelEvent } from './duel-events';

/**
 * Publishes `DuelEvent`s through `pg_notify` so every process on the shared
 * database — in particular api-v1's socket gateway — hears about ladder
 * changes made anywhere. Fire-and-forget: a failed notify is logged, never
 * thrown, because the write it announces has already committed.
 */
@Injectable()
export class DuelEventsPublisher {
  private readonly logger = new Logger(DuelEventsPublisher.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  publish(event: DuelEvent): void {
    void this.dataSource
      .query('SELECT pg_notify($1, $2)', [
        DUEL_EVENTS_CHANNEL,
        JSON.stringify(event),
      ])
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`pg_notify(${event.scope}) failed: ${message}`);
      });
  }

  queueChanged(): void {
    this.publish({ scope: 'queue' });
  }

  duelChanged(duelId: string): void {
    this.publish({ scope: 'duel', duelId });
  }

  playersChanged(playerIds: string[]): void {
    if (playerIds.length) this.publish({ scope: 'players', playerIds });
  }

  botsChanged(): void {
    this.publish({ scope: 'bots' });
  }

  /** These players' inboxes changed — the notification gateway re-pushes their snapshot. */
  notificationsChanged(playerIds: string[]): void {
    if (playerIds.length) this.publish({ scope: 'notification', playerIds });
  }
}
