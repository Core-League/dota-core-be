import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { HostBotStatus } from './duel.constants';
import { HostBot } from './host-bot.entity';
import {
  decryptHostBotPassword,
  encryptHostBotPassword,
} from './host-bot.crypto';
import {
  CreateHostBotDto,
  HostBotDto,
  UpdateHostBotDto,
} from './dto/duel-admin.dto';

/** A worker that has not touched its rows for this long is considered dead. */
const ALIVE_WINDOW_MS = 30_000;

/** Plain credentials handed to the bot-worker pool (never leave the process). */
export interface HostBotAccount {
  id: number;
  accountName: string;
  password: string;
  region: number;
}

/**
 * Host bot accounts: written by the admin panel, read by the bot-worker.
 * Status / heartbeat columns are the worker's; the admin only flips
 * `enabled` and manages credentials.
 */
@Injectable()
export class HostBotsService {
  constructor(
    @InjectRepository(HostBot) private readonly repo: Repository<HostBot>,
  ) {}

  private toDto(bot: HostBot): HostBotDto {
    const alive =
      bot.lastHeartbeatAt != null &&
      Date.now() - bot.lastHeartbeatAt.getTime() < ALIVE_WINDOW_MS;
    return {
      id: bot.id,
      accountName: bot.accountName,
      steamId64: bot.steamId64,
      region: bot.region,
      status: bot.status,
      currentDuelId: bot.currentDuelId,
      lastError: bot.lastError,
      lastHeartbeatAt: bot.lastHeartbeatAt,
      enabled: bot.enabled,
      alive,
    };
  }

  // ── admin ────────────────────────────────────────────────────────────────

  async list(): Promise<HostBotDto[]> {
    const rows = await this.repo.find({ order: { id: 'ASC' } });
    return rows.map((b) => this.toDto(b));
  }

  async create(dto: CreateHostBotDto): Promise<HostBotDto> {
    const accountName = dto.accountName.trim();
    const existing = await this.repo.findOne({ where: { accountName } });
    if (existing) {
      throw new ConflictException({
        error: 'host_bot_exists',
        message: `Акаунт ${accountName} уже в пулі`,
      });
    }
    const bot = this.repo.create({
      accountName,
      passwordEnc: encryptHostBotPassword(dto.password),
      region: dto.region ?? 3,
      status: HostBotStatus.OFFLINE,
      enabled: true,
    });
    return this.toDto(await this.repo.save(bot));
  }

  async update(id: number, dto: UpdateHostBotDto): Promise<HostBotDto> {
    const bot = await this.repo.findOne({ where: { id } });
    if (!bot) throw new NotFoundException('Host bot not found');
    if (dto.password != null) {
      bot.passwordEnc = encryptHostBotPassword(dto.password);
    }
    if (dto.enabled != null) {
      bot.enabled = dto.enabled;
    }
    return this.toDto(await this.repo.save(bot));
  }

  async remove(id: number): Promise<void> {
    const bot = await this.repo.findOne({ where: { id } });
    if (!bot) throw new NotFoundException('Host bot not found');
    if (bot.status === HostBotStatus.BUSY) {
      throw new ConflictException({
        error: 'host_bot_busy',
        message:
          'Бот зараз хостить дуель — вимкніть його і дочекайтесь завершення',
      });
    }
    await this.repo.remove(bot);
  }

  // ── worker ───────────────────────────────────────────────────────────────

  /** Accounts the pool should be running right now, with decrypted passwords. */
  async loadRunnableAccounts(): Promise<HostBotAccount[]> {
    const rows = await this.repo.find({
      where: { enabled: true, status: Not(HostBotStatus.BANNED) },
      order: { id: 'ASC' },
    });
    const out: HostBotAccount[] = [];
    for (const row of rows) {
      out.push({
        id: row.id,
        accountName: row.accountName,
        password: decryptHostBotPassword(row.passwordEnc),
        region: row.region,
      });
    }
    return out;
  }

  async setStatus(
    id: number,
    patch: {
      status?: HostBotStatus;
      currentDuelId?: string | null;
      steamId64?: string | null;
      lastError?: string | null;
    },
  ): Promise<void> {
    await this.repo.update({ id }, { ...patch, lastHeartbeatAt: new Date() });
  }

  async heartbeat(ids: number[]): Promise<void> {
    if (!ids.length) return;
    await this.repo
      .createQueryBuilder()
      .update(HostBot)
      .set({ lastHeartbeatAt: () => 'now()' })
      .whereInIds(ids)
      .execute();
  }
}
