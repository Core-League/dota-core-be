import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Not } from 'typeorm';
import { OpenDotaMatch } from '../dota2/dota2.service';
import { Dota2Service } from '../dota2/dota2.service';
import { QualificationMatch } from '../qualification/qualification-match.entity';

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

  private get isProdEnv(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  async sendMatchResult(match: OpenDotaMatch): Promise<void> {
    if (!this.isProdEnv) return;

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
      `[Duelo] Sending match ${payload.matchId} with ${players.length} players`,
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

  async syncAllMatches(): Promise<{ sent: number; errors: number }> {
    if (!this.isProdEnv) {
      this.logger.warn('[Duelo] Sync skipped — not a production environment');
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
