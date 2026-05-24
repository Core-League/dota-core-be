import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Not } from 'typeorm';
import { OpenDotaMatch } from '../dota2/dota2.service';
import { Dota2Service } from '../dota2/dota2.service';
import { QualificationMatch } from '../qualification/qualification-match.entity';
import { Playoff } from '../playoff/playoff.entity';
import { PlayoffMatch } from '../playoff/playoff-match.entity';

const STEAM_ID_OFFSET = 76561197960265728n;
const WEBHOOK_URL = 'https://duelo.gg/api/partners/webhook';

interface DueloPlayer {
  steamId: string;
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  gpm: number;
  xpm: number;
  heroDamage: number;
  towerDamage: number;
  healing: number;
}

interface DueloMatchPayload {
  matchId: string;
  playedAt: string;
  players: DueloPlayer[];
}

@Injectable()
export class DueloService {
  private readonly logger = new Logger(DueloService.name);

  constructor(
    private readonly http: HttpService,
    private readonly dota2: Dota2Service,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  private get apiKey(): string {
    return process.env.DUELO_API_KEY ?? '';
  }

  /**
   * Live deploy uses `NODE_ENV=staging` (see ecosystem.config.js). Partner webhook
   * must run there too — same constraint as TypeORM prod-like mode in app.module.
   */
  private get isPartnerWebhookEnv(): boolean {
    const env = process.env.NODE_ENV;
    return env === 'production' || env === 'staging';
  }

  async sendMatchResult(match: OpenDotaMatch, source?: string): Promise<void> {
    if (!this.isPartnerWebhookEnv) {
      this.logger.debug(
        `[Duelo] sendMatchResult skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}) for match ${match.match_id}${source ? ` from ${source}` : ''}`,
      );
      return;
    }

    const playedAt = new Date(
      (match.start_time + match.duration) * 1000,
    ).toISOString();

    const players: DueloPlayer[] = match.players
      .filter((p) => p.account_id && p.account_id !== 0)
      .map((p) => ({
        steamId: (BigInt(p.account_id) + STEAM_ID_OFFSET).toString(),
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        lastHits: p.last_hits,
        gpm: p.gold_per_min,
        xpm: p.xp_per_min,
        heroDamage: p.hero_damage,
        towerDamage: p.tower_damage,
        healing: p.hero_healing,
      }));

    const payload: DueloMatchPayload = {
      matchId: match.match_id.toString(),
      playedAt,
      players,
    };

    this.logger.log(
      `[Duelo] Sending match ${payload.matchId} with ${players.length} players${source ? ` (source: ${source})` : ''}`,
    );
    this.logger.debug(`[Duelo] Payload: ${JSON.stringify(payload)}`);

    try {
      const response = await firstValueFrom(
        this.http.post(WEBHOOK_URL, payload, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        }),
      );
      this.logger.log(
        `[Duelo] Match ${payload.matchId} accepted — status ${response.status}`,
      );
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { status?: number; data?: unknown };
        message?: string;
      };
      const status = axiosErr.response?.status ?? 'no-response';
      const body = JSON.stringify(
        axiosErr.response?.data ?? axiosErr.message ?? String(err),
      );
      this.logger.error(
        `[Duelo] Failed to send match ${payload.matchId} — HTTP ${status}: ${body}`,
      );
    }
  }

  async syncTournamentMatches(
    tournamentId: string,
  ): Promise<{ sent: number; errors: number; skipped: number }> {
    if (!this.isPartnerWebhookEnv) {
      this.logger.warn(
        `[Duelo] Tournament sync skipped — enabled only for NODE_ENV=production or staging (current=${process.env.NODE_ENV ?? 'undefined'})`,
      );
      return { sent: 0, errors: 0, skipped: 0 };
    }

    const qualMatches = await this.dataSource
      .getRepository(QualificationMatch)
      .createQueryBuilder('qm')
      .innerJoin('qm.qualification', 'q')
      .where('q.tournamentId = :tournamentId', { tournamentId })
      .andWhere('qm.dotaMatchId IS NOT NULL')
      .getMany();

    const playoff = await this.dataSource
      .getRepository(Playoff)
      .findOne({ where: { tournamentId } });

    const playoffMatches = playoff
      ? await this.dataSource.getRepository(PlayoffMatch).find({
          where: { playoffId: playoff.id, dotaMatchId: Not(IsNull()) },
        })
      : [];

    const realPlayoffMatches = playoffMatches.filter(
      (m) =>
        m.dotaMatchId &&
        !m.dotaMatchId.startsWith('tech_loss_') &&
        !m.dotaMatchId.startsWith('manual_'),
    );

    const skipped = playoffMatches.length - realPlayoffMatches.length;

    const allDotaIds = [
      ...qualMatches.map((m) => m.dotaMatchId!),
      ...realPlayoffMatches.map((m) => m.dotaMatchId!),
    ];

    this.logger.log(
      `[Duelo] Syncing tournament ${tournamentId}: ${qualMatches.length} qual + ${realPlayoffMatches.length} playoff matches (${skipped} playoff skipped — no real dotaMatchId)`,
    );

    let sent = 0;
    let errors = 0;

    for (const dotaMatchId of allDotaIds) {
      try {
        const matchData = await this.dota2.getOpenDotaMatch(dotaMatchId);
        await this.sendMatchResult(matchData, `sync:${tournamentId}`);
        sent++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `[Duelo] Sync failed for dota match ${dotaMatchId}: ${message}`,
        );
        errors++;
      }
    }

    this.logger.log(
      `[Duelo] Sync complete for tournament ${tournamentId} — sent: ${sent}, errors: ${errors}, skipped: ${skipped}`,
    );
    return { sent, errors, skipped };
  }

  async syncAllMatches(): Promise<{ sent: number; errors: number }> {
    if (!this.isPartnerWebhookEnv) {
      this.logger.warn(
        `[Duelo] Sync skipped — enabled only for NODE_ENV=production or staging (current=${process.env.NODE_ENV ?? 'undefined'})`,
      );
      return { sent: 0, errors: 0 };
    }

    const matches = await this.dataSource
      .getRepository(QualificationMatch)
      .find({ where: { dotaMatchId: Not(IsNull()) } });

    this.logger.log(`[Duelo] Syncing ${matches.length} historical matches`);

    let sent = 0;
    let errors = 0;

    for (const qm of matches) {
      try {
        const matchData = await this.dota2.getOpenDotaMatch(qm.dotaMatchId!);
        await this.sendMatchResult(matchData);
        sent++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `[Duelo] Sync failed for dota match ${qm.dotaMatchId}: ${message}`,
        );
        errors++;
      }
    }

    this.logger.log(`[Duelo] Sync complete — sent: ${sent}, errors: ${errors}`);
    return { sent, errors };
  }
}
