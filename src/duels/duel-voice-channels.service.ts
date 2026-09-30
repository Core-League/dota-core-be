import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { DiscordBotService } from '../discord/discord-bot.service';
import {
  DUEL_TERMINAL_STATES,
  DUEL_VOICE_CHANNEL_GRACE_SECONDS,
  DUEL_VOICE_CHANNEL_STATES,
  DUEL_VOICE_CHANNEL_SWEEP_MS,
} from './duel.constants';
import { Duel } from './duel.entity';
import type { DuelEvent } from './duel-events';
import { DuelEventsPublisher } from './duel-events.publisher';

/**
 * Discord voice channel of a duel ("Duel #N"), api-v1 side. Driven by the
 * same `duel_events` bus that feeds the socket gateway: once a duel reaches
 * PENDING (both players accepted) the channel is created and the players
 * get its link with the next status push; once the duel is terminal the
 * channel is deleted after a short grace period. A periodic sweep repeats
 * both checks against the database, so a missed notification or a restart
 * of api-v1 never leaves a duel without a channel or a channel without a
 * duel. Discord being down only costs the channel — the duel goes on.
 */
@Injectable()
export class DuelVoiceChannelsService implements OnModuleDestroy {
  private readonly logger = new Logger(DuelVoiceChannelsService.name);
  /** Duels whose channel is being created / deleted right now — one operation per duel at a time. */
  private readonly inFlight = new Set<string>();
  /** Terminal duels waiting out the grace period before their channel goes. */
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectRepository(Duel) private readonly duels: Repository<Duel>,
    private readonly discord: DiscordBotService,
    private readonly events: DuelEventsPublisher,
  ) {}

  onModuleDestroy(): void {
    for (const timer of this.graceTimers.values()) clearTimeout(timer);
    this.graceTimers.clear();
  }

  /** A ladder change was announced (by any process): re-check the duel it concerns. */
  onEvent(event: DuelEvent): void {
    if (event.scope !== 'duel') return;
    void this.sync(event.duelId).catch((err: unknown) => {
      this.logger.warn(`sync ${event.duelId} failed: ${this.errMsg(err)}`);
    });
  }

  /** Fallback for missed events and restarts: running duels without a channel, ended duels with one. */
  @Interval(DUEL_VOICE_CHANNEL_SWEEP_MS)
  async sweep(): Promise<void> {
    try {
      const rows = await this.duels.find({
        select: { id: true },
        where: [
          {
            state: In([...DUEL_VOICE_CHANNEL_STATES]),
            discordVoiceChannelId: IsNull(),
          },
          {
            state: In([...DUEL_TERMINAL_STATES]),
            discordVoiceChannelId: Not(IsNull()),
          },
        ],
      });
      for (const row of rows) {
        await this.sync(row.id).catch((err: unknown) => {
          this.logger.warn(`sweep ${row.id} failed: ${this.errMsg(err)}`);
        });
      }
    } catch (err) {
      this.logger.warn(`sweep failed: ${this.errMsg(err)}`);
    }
  }

  /**
   * Brings the channel in line with the duel's state: create it while the
   * duel runs, delete it (after the grace period) once the duel ended.
   */
  async sync(duelId: string): Promise<void> {
    if (this.inFlight.has(duelId)) return;
    this.inFlight.add(duelId);
    try {
      const duel = await this.duels.findOne({
        where: { id: duelId },
        relations: { player1: true, player2: true },
      });
      if (!duel) return;
      if (DUEL_VOICE_CHANNEL_STATES.includes(duel.state)) {
        if (!duel.discordVoiceChannelId) await this.create(duel);
        return;
      }
      if (!DUEL_TERMINAL_STATES.includes(duel.state)) return;
      if (!duel.discordVoiceChannelId) return;
      const endedAt = duel.finishedAt ?? duel.updatedAt;
      const dueAt = endedAt.getTime() + DUEL_VOICE_CHANNEL_GRACE_SECONDS * 1000;
      if (dueAt > Date.now()) {
        this.scheduleRemoval(duel.id, dueAt - Date.now());
        return;
      }
      await this.remove(duel);
    } finally {
      this.inFlight.delete(duelId);
    }
  }

  /**
   * Admin delete of one duel: its channel goes before the row does (otherwise
   * nothing would remember it). False when there was no channel or Discord
   * refused — the caller deletes the duel either way.
   */
  async deleteOne(duelId: string): Promise<boolean> {
    const row = await this.duels.findOne({
      select: { id: true, number: true, discordVoiceChannelId: true },
      where: { id: duelId },
    });
    if (!row) return false;
    return this.remove(row);
  }

  /** Admin purge: every channel goes before the duels do (otherwise nothing would remember them). */
  async deleteAll(): Promise<number> {
    const rows = await this.duels.find({
      select: { id: true, number: true, discordVoiceChannelId: true },
      where: { discordVoiceChannelId: Not(IsNull()) },
    });
    let deleted = 0;
    for (const row of rows) {
      if (await this.remove(row)) deleted += 1;
    }
    return deleted;
  }

  private async create(duel: Duel): Promise<void> {
    const discordIds = [
      duel.player1?.discordId,
      duel.player2?.discordId,
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);
    const channelId = await this.discord.createDuelVoiceChannel(
      duel.number,
      discordIds,
    );
    if (!channelId) return;
    // Conditional write: should another process have created one meanwhile, ours is the extra.
    const result = await this.duels.update(
      { id: duel.id, discordVoiceChannelId: IsNull() },
      { discordVoiceChannelId: channelId },
    );
    if (!result.affected) {
      await this.discord.deleteChannel(channelId);
      return;
    }
    this.logger.log(
      `Duel #${duel.number} (${duel.id}): voice channel ${channelId} created for ${discordIds.length} player(s)`,
    );
    // The players get the link with the next status push.
    this.events.duelChanged(duel.id);
  }

  private async remove(
    duel: Pick<Duel, 'id' | 'number' | 'discordVoiceChannelId'>,
  ): Promise<boolean> {
    const channelId = duel.discordVoiceChannelId;
    if (!channelId) return false;
    const gone = await this.discord.deleteChannel(channelId);
    if (!gone) return false; // Discord hiccup — the sweep retries
    await this.duels.update({ id: duel.id }, { discordVoiceChannelId: null });
    this.logger.log(
      `Duel #${duel.number} (${duel.id}): voice channel ${channelId} deleted`,
    );
    return true;
  }

  private scheduleRemoval(duelId: string, inMs: number): void {
    if (this.graceTimers.has(duelId)) return;
    const timer = setTimeout(() => {
      this.graceTimers.delete(duelId);
      void this.sync(duelId).catch((err: unknown) => {
        this.logger.warn(`delayed sync ${duelId} failed: ${this.errMsg(err)}`);
      });
    }, inMs + 500);
    timer.unref();
    this.graceTimers.set(duelId, timer);
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
