import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { FriendsService } from '../friends/friends.service';
import {
  NotificationStatus,
  NotificationType,
} from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { Player } from '../players/player.entity';
import {
  DUEL_CHALLENGE_DAILY_LIMIT,
  DUEL_CHALLENGE_TTL_SECONDS,
  DuelChallengeStatus,
} from './duel.constants';
import { DuelChallenge } from './duel-challenge.entity';
import { DuelEventsPublisher } from './duel-events.publisher';
import { DuelQueueEntry } from './duel-queue.entity';
import { DuelsService } from './duels.service';
import { HostBotsService } from './host-bots.service';
import type { DuelStatusDto } from './dto/duel.dto';

const CHALLENGE_TYPES = [NotificationType.DUEL_CHALLENGE];

/**
 * Friendly duel challenges (api-v1 only). A challenge is an invitation
 * between friends; accepting it creates a `friend` duel straight in PENDING
 * (both already agreed — no 30 s accept window) that the bot-worker drives
 * exactly like a ranked one. Every mutation returns the caller's duel status.
 */
@Injectable()
export class DuelChallengesService {
  private readonly logger = new Logger(DuelChallengesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(DuelChallenge)
    private readonly challenges: Repository<DuelChallenge>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    private readonly duels: DuelsService,
    private readonly hostBots: HostBotsService,
    private readonly friends: FriendsService,
    private readonly notifications: NotificationsService,
    private readonly events: DuelEventsPublisher,
  ) {}

  // ── rules ────────────────────────────────────────────────────────────────

  /** Both players must be able to play a duel right now: Steam linked, no active duel. */
  private async assertCanPlay(
    player: Player,
    who: 'you' | 'friend',
  ): Promise<void> {
    if (!player.steamId) {
      throw new BadRequestException({
        error: who === 'you' ? 'steam_not_linked' : 'friend_steam_not_linked',
        message:
          who === 'you'
            ? 'Прив’яжіть Steam-акаунт у профілі, щоб грати дуелі'
            : 'У друга не прив’язаний Steam-акаунт — дуель неможлива',
      });
    }
    if (await this.duels.findActiveDuelForPlayer(player.id)) {
      throw new ConflictException({
        error: who === 'you' ? 'active_duel' : 'friend_busy',
        message:
          who === 'you'
            ? 'У вас уже є активна дуель'
            : 'Друг зараз у дуелі — спробуйте пізніше',
      });
    }
  }

  private async assertUnderDailyLimit(
    playerId: string,
    who: 'you' | 'friend',
  ): Promise<void> {
    const accepted = await this.duels.countAcceptedChallengesToday(playerId);
    if (accepted >= DUEL_CHALLENGE_DAILY_LIMIT) {
      throw new HttpException(
        {
          error: who === 'you' ? 'daily_limit' : 'friend_daily_limit',
          message:
            who === 'you'
              ? `Ліміт дружніх дуелей на сьогодні вичерпано (${DUEL_CHALLENGE_DAILY_LIMIT} на день)`
              : `У друга вичерпано ліміт дружніх дуелей на сьогодні (${DUEL_CHALLENGE_DAILY_LIMIT} на день)`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async assertBotsOnline(): Promise<void> {
    const bots = await this.hostBots.publicStatus();
    if (bots.online === 0) {
      throw new HttpException(
        {
          error: 'no_bots_online',
          message:
            'Жоден бот-хост зараз не онлайн — дуелі тимчасово недоступні',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  // ── mutations ────────────────────────────────────────────────────────────

  async create(me: string, targetId: string): Promise<DuelStatusDto> {
    if (me === targetId) {
      throw new BadRequestException({
        error: 'self_challenge',
        message: 'Викликати на дуель самого себе не можна',
      });
    }
    const [challenger, target] = await Promise.all([
      this.players.findOne({ where: { id: me } }),
      this.players.findOne({ where: { id: targetId } }),
    ]);
    if (!challenger) throw new NotFoundException('Player not found');
    if (!target) {
      throw new NotFoundException({
        error: 'player_not_found',
        message: 'Гравця не знайдено',
      });
    }
    if (!(await this.friends.areFriends(me, targetId))) {
      throw new ForbiddenException({
        error: 'not_friends',
        message: 'Викликати на дружню дуель можна лише друга',
      });
    }
    await this.assertCanPlay(challenger, 'you');
    await this.assertCanPlay(target, 'friend');
    await this.assertUnderDailyLimit(me, 'you');
    await this.assertUnderDailyLimit(targetId, 'friend');
    await this.assertBotsOnline();

    const open = await this.challenges.findOne({
      where: { challengerId: me, status: DuelChallengeStatus.PENDING },
    });
    if (open) {
      throw new ConflictException({
        error: 'challenge_pending',
        message:
          open.challengedId === targetId
            ? 'Виклик уже надіслано — чекаємо на відповідь друга'
            : 'У вас уже є відкритий виклик — скасуйте його, щоб надіслати інший',
      });
    }
    const incoming = await this.challenges.findOne({
      where: {
        challengerId: targetId,
        challengedId: me,
        status: DuelChallengeStatus.PENDING,
      },
    });
    // The friend already asked us — answering with a challenge of our own means "yes".
    if (incoming) return this.accept(me, incoming.id);

    const expiresAt = new Date(Date.now() + DUEL_CHALLENGE_TTL_SECONDS * 1000);
    const saved = await this.challenges.save(
      this.challenges.create({
        challengerId: me,
        challengedId: targetId,
        status: DuelChallengeStatus.PENDING,
        expiresAt,
      }),
    );
    await this.notifications.create({
      playerId: targetId,
      type: NotificationType.DUEL_CHALLENGE,
      refId: saved.id,
      status: NotificationStatus.PENDING,
      actor: challenger,
      payload: { expiresAt: expiresAt.toISOString() },
    });
    this.events.playersChanged([me, targetId]);
    this.logger.log(`challenge ${saved.id}: ${me} → ${targetId}`);
    return this.duels.getStatus(me);
  }

  private async findChallenge(id: string): Promise<DuelChallenge> {
    const row = await this.challenges.findOne({
      where: { id },
      relations: ['challenger', 'challenged'],
    });
    if (!row) {
      throw new NotFoundException({
        error: 'challenge_not_found',
        message: 'Виклик уже не існує',
      });
    }
    return row;
  }

  private assertPending(row: DuelChallenge): void {
    if (row.status === DuelChallengeStatus.PENDING) {
      if (row.expiresAt.getTime() > Date.now()) return;
      throw new ConflictException({
        error: 'challenge_expired',
        message: 'Час на відповідь минув — виклик прострочено',
      });
    }
    throw new ConflictException({
      error: 'challenge_not_pending',
      message:
        row.status === DuelChallengeStatus.ACCEPTED
          ? 'Виклик уже прийнято'
          : row.status === DuelChallengeStatus.DECLINED
            ? 'Виклик уже відхилено'
            : row.status === DuelChallengeStatus.CANCELLED
              ? 'Виклик скасовано'
              : 'Виклик прострочено',
    });
  }

  /**
   * The challenged friend says yes: both leave the queue (if there) and a
   * `friend` duel is created in PENDING for the next free host bot.
   */
  async accept(me: string, id: string): Promise<DuelStatusDto> {
    const row = await this.findChallenge(id);
    if (row.challengedId !== me) {
      throw new ForbiddenException({
        error: 'not_challenged',
        message: 'Прийняти виклик може лише той, кого викликали',
      });
    }
    this.assertPending(row);
    await this.assertCanPlay(row.challenged, 'you');
    await this.assertCanPlay(row.challenger, 'friend');
    await this.assertUnderDailyLimit(me, 'you');
    await this.assertUnderDailyLimit(row.challengerId, 'friend');
    await this.assertBotsOnline();

    const duelId = await this.dataSource.transaction(async (em) => {
      const locked = await em.findOne(DuelChallenge, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Challenge not found');
      this.assertPending(locked);
      await em.delete(DuelQueueEntry, {
        playerId: In([locked.challengerId, locked.challengedId]),
      });
      const duel = await this.duels.createFriendDuel(
        em,
        locked.challengerId,
        locked.challengedId,
      );
      locked.status = DuelChallengeStatus.ACCEPTED;
      locked.duelId = duel.id;
      locked.respondedAt = new Date();
      await em.save(locked);
      return duel.id;
    });

    await this.notifications.resolveByRef(
      row.id,
      CHALLENGE_TYPES,
      NotificationStatus.ACCEPTED,
    );
    await this.notifications.create({
      playerId: row.challengerId,
      type: NotificationType.DUEL_CHALLENGE_ACCEPTED,
      refId: row.id,
      actor: row.challenged,
      payload: { duelId },
    });
    this.events.duelChanged(duelId);
    this.events.queueChanged();
    this.events.playersChanged([row.challengerId, row.challengedId]);
    this.logger.log(
      `challenge ${row.id} accepted by ${me} → friendly duel ${duelId}`,
    );
    return this.duels.getStatus(me);
  }

  async decline(me: string, id: string): Promise<DuelStatusDto> {
    const row = await this.findChallenge(id);
    if (row.challengedId !== me) {
      throw new ForbiddenException({
        error: 'not_challenged',
        message: 'Відхилити виклик може лише той, кого викликали',
      });
    }
    this.assertPending(row);
    row.status = DuelChallengeStatus.DECLINED;
    row.respondedAt = new Date();
    await this.challenges.save(row);
    await this.notifications.resolveByRef(
      row.id,
      CHALLENGE_TYPES,
      NotificationStatus.DECLINED,
    );
    await this.notifications.create({
      playerId: row.challengerId,
      type: NotificationType.DUEL_CHALLENGE_DECLINED,
      refId: row.id,
      actor: row.challenged,
    });
    this.events.playersChanged([row.challengerId, row.challengedId]);
    return this.duels.getStatus(me);
  }

  /** Challenger withdraws their own open challenge. */
  async cancel(me: string, id: string): Promise<DuelStatusDto> {
    const row = await this.findChallenge(id);
    if (row.challengerId !== me) {
      throw new ForbiddenException({
        error: 'not_challenger',
        message: 'Скасувати виклик може лише його автор',
      });
    }
    this.assertPending(row);
    row.status = DuelChallengeStatus.CANCELLED;
    row.respondedAt = new Date();
    await this.challenges.save(row);
    await this.notifications.resolveByRef(
      row.id,
      CHALLENGE_TYPES,
      NotificationStatus.CANCELLED,
    );
    this.events.playersChanged([row.challengerId, row.challengedId]);
    return this.duels.getStatus(me);
  }

  /** Matchmaker tick: PENDING challenges past their deadline. */
  async expirePending(): Promise<number> {
    const stale = await this.challenges.find({
      where: {
        status: DuelChallengeStatus.PENDING,
        expiresAt: LessThan(new Date()),
      },
      relations: ['challenged'],
    });
    for (const row of stale) {
      const updated = await this.challenges.update(
        { id: row.id, status: DuelChallengeStatus.PENDING },
        { status: DuelChallengeStatus.EXPIRED, respondedAt: new Date() },
      );
      if (!updated.affected) continue;
      await this.notifications.resolveByRef(
        row.id,
        CHALLENGE_TYPES,
        NotificationStatus.EXPIRED,
      );
      await this.notifications.create({
        playerId: row.challengerId,
        type: NotificationType.DUEL_CHALLENGE_EXPIRED,
        refId: row.id,
        actor: row.challenged,
      });
      this.events.playersChanged([row.challengerId, row.challengedId]);
      this.logger.log(`challenge ${row.id} expired`);
    }
    return stale.length;
  }
}
