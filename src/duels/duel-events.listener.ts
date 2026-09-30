import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Client, type ClientConfig, type Notification } from 'pg';
import { getPostgresDataSourceOptions } from '../config/postgres-connection';
import { DUEL_EVENTS_CHANNEL, parseDuelEvent } from './duel-events';
import { DuelsGateway } from './duels.gateway';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * api-v1 side of the duel event bus: one dedicated Postgres connection that
 * `LISTEN`s on `duel_events` (TypeORM's pool cannot hold a LISTEN session)
 * and hands every notification — from this process, the matchmaker or the
 * bot-worker — to the socket gateway. Reconnects with backoff; while it is
 * down the page falls back to polling, nothing is lost.
 */
@Injectable()
export class DuelEventsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuelEventsListener.name);
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = RECONNECT_MIN_MS;
  private stopped = false;

  constructor(private readonly gateway: DuelsGateway) {}

  onModuleInit(): void {
    void this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    await this.dropClient();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    // Same connection as TypeORM (DATABASE_URL or DB_*; same TLS rule) — a
    // listener that cannot log in leaves the page without any pushes.
    const options = getPostgresDataSourceOptions();
    const client = new Client({
      ...(options.url
        ? { connectionString: options.url }
        : {
            host: options.host,
            port: options.port,
            user: options.username,
            password: options.password,
            database: options.database,
          }),
      // TypeORM types TLS as `TlsOptions`, pg as `ConnectionOptions`; the runtime object is the same.
      ssl: options.ssl as ClientConfig['ssl'],
      application_name: 'core-duel-events',
    });
    client.on('notification', (msg: Notification) => this.onNotification(msg));
    client.on('error', (err: Error) => {
      this.logger.warn(`listener connection error: ${err.message}`);
      this.scheduleReconnect();
    });
    client.on('end', () => this.scheduleReconnect());
    try {
      await client.connect();
      await client.query(`LISTEN ${DUEL_EVENTS_CHANNEL}`);
      this.client = client;
      this.backoffMs = RECONNECT_MIN_MS;
      this.logger.log(`Listening on Postgres channel "${DUEL_EVENTS_CHANNEL}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`could not LISTEN ${DUEL_EVENTS_CHANNEL}: ${message}`);
      client.removeAllListeners();
      client.end().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  private onNotification(msg: Notification): void {
    if (msg.channel !== DUEL_EVENTS_CHANNEL || !msg.payload) return;
    const event = parseDuelEvent(msg.payload);
    if (!event) {
      this.logger.warn(`ignoring malformed duel event: ${msg.payload}`);
      return;
    }
    this.logger.log(
      `duel_events ← ${msg.payload} (from backend pid ${msg.processId})`,
    );
    this.gateway.onEvent(event);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    void this.dropClient();
    this.logger.warn(`reconnecting the listener in ${this.backoffMs / 1000}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_MS);
      void this.connect();
    }, this.backoffMs);
  }

  private async dropClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    client.removeAllListeners();
    await client.end().catch(() => undefined);
  }
}
