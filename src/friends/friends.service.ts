import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DuelRating } from '../duels/duel-rating.entity';
import { DuelEventsPublisher } from '../duels/duel-events.publisher';
import {
  NotificationStatus,
  NotificationType,
} from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { Player } from '../players/player.entity';
import { FriendRelation, FriendshipStatus } from './friends.constants';
import { Friendship } from './friendship.entity';
import {
  FriendDto,
  FriendPlayerDto,
  FriendRelationDto,
  FriendRequestDto,
  FriendsOverviewDto,
} from './dto/friends.dto';

const FRIEND_REQUEST_TYPES = [NotificationType.FRIEND_REQUEST];

/**
 * Friend requests and friendships. Every mutation returns the caller's fresh
 * overview (the page replaces its state with it) and announces both players
 * on the duel event bus, so an open duels page re-reads "who can I challenge".
 */
@Injectable()
export class FriendsService {
  private readonly logger = new Logger(FriendsService.name);

  constructor(
    @InjectRepository(Friendship)
    private readonly friendships: Repository<Friendship>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(DuelRating)
    private readonly ratings: Repository<DuelRating>,
    private readonly notifications: NotificationsService,
    private readonly events: DuelEventsPublisher,
  ) {}

  // ── mapping ──────────────────────────────────────────────────────────────

  private toPlayerDto(
    player: Player,
    ratings: Map<string, DuelRating>,
  ): FriendPlayerDto {
    return {
      id: player.id,
      discordName: player.discordName ?? null,
      discordUsername: player.discordUsername ?? null,
      avatarUrl: player.avatarUrl ?? null,
      steamId: player.steamId ?? null,
      countryCode: player.countryCode ?? null,
      rating: player.rating ?? 0,
      duelRating: ratings.get(player.id)?.rating ?? 0,
    };
  }

  private async ratingsFor(
    rows: Friendship[],
  ): Promise<Map<string, DuelRating>> {
    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.requesterId);
      ids.add(r.addresseeId);
    }
    if (!ids.size) return new Map();
    const ratings = await this.ratings.find({
      where: { playerId: In([...ids]) },
    });
    return new Map(ratings.map((r) => [r.playerId, r]));
  }

  // ── lookups ──────────────────────────────────────────────────────────────

  /** The single row of an unordered pair, whatever its direction; null when none. */
  findPair(a: string, b: string): Promise<Friendship | null> {
    return this.friendships.findOne({
      where: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
      relations: ['requester', 'addressee'],
    });
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const row = await this.findPair(a, b);
    return row?.status === FriendshipStatus.ACCEPTED;
  }

  async relationWith(me: string, other: string): Promise<FriendRelationDto> {
    const row = await this.findPair(me, other);
    if (!row) return { relation: FriendRelation.NONE, requestId: null };
    if (row.status === FriendshipStatus.ACCEPTED) {
      return { relation: FriendRelation.FRIENDS, requestId: null };
    }
    return {
      relation:
        row.requesterId === me
          ? FriendRelation.OUTGOING
          : FriendRelation.INCOMING,
      requestId: row.id,
    };
  }

  async overview(playerId: string): Promise<FriendsOverviewDto> {
    const rows = await this.friendships.find({
      where: [{ requesterId: playerId }, { addresseeId: playerId }],
      relations: ['requester', 'addressee'],
      order: { createdAt: 'DESC' },
    });
    const ratings = await this.ratingsFor(rows);
    const friends: FriendDto[] = [];
    const incoming: FriendRequestDto[] = [];
    const outgoing: FriendRequestDto[] = [];
    for (const row of rows) {
      if (row.status === FriendshipStatus.ACCEPTED) {
        const other =
          row.requesterId === playerId ? row.addressee : row.requester;
        friends.push({
          friendshipId: row.id,
          player: this.toPlayerDto(other, ratings),
          since: row.respondedAt ?? row.createdAt,
        });
        continue;
      }
      const dto: FriendRequestDto = {
        id: row.id,
        status: row.status,
        requester: this.toPlayerDto(row.requester, ratings),
        addressee: this.toPlayerDto(row.addressee, ratings),
        createdAt: row.createdAt,
      };
      (row.requesterId === playerId ? outgoing : incoming).push(dto);
    }
    friends.sort((a, b) =>
      (a.player.discordName ?? '').localeCompare(b.player.discordName ?? ''),
    );
    return { friends, incoming, outgoing };
  }

  // ── mutations ────────────────────────────────────────────────────────────

  async sendRequest(me: string, targetId: string): Promise<FriendsOverviewDto> {
    if (me === targetId) {
      throw new BadRequestException({
        error: 'self_request',
        message: 'Не можна додати в друзі самого себе',
      });
    }
    const [requester, target] = await Promise.all([
      this.players.findOne({ where: { id: me } }),
      this.players.findOne({ where: { id: targetId } }),
    ]);
    if (!requester) throw new NotFoundException('Player not found');
    if (!target) {
      throw new NotFoundException({
        error: 'player_not_found',
        message: 'Гравця не знайдено',
      });
    }
    const existing = await this.findPair(me, targetId);
    if (existing) {
      if (existing.status === FriendshipStatus.ACCEPTED) {
        throw new ConflictException({
          error: 'already_friends',
          message: 'Ви вже друзі',
        });
      }
      if (existing.requesterId === me) {
        throw new ConflictException({
          error: 'request_pending',
          message: 'Запит уже надіслано — чекаємо на відповідь',
        });
      }
      // They asked first — answering with a request of our own means "yes".
      return this.acceptRequest(me, existing.id);
    }
    const saved = await this.friendships.save(
      this.friendships.create({
        requesterId: me,
        addresseeId: targetId,
        status: FriendshipStatus.PENDING,
      }),
    );
    await this.notifications.create({
      playerId: targetId,
      type: NotificationType.FRIEND_REQUEST,
      refId: saved.id,
      status: NotificationStatus.PENDING,
      actor: requester,
    });
    this.events.playersChanged([me, targetId]);
    this.logger.log(`friend request ${saved.id}: ${me} → ${targetId}`);
    return this.overview(me);
  }

  private async findRequest(id: string): Promise<Friendship> {
    const row = await this.friendships.findOne({
      where: { id },
      relations: ['requester', 'addressee'],
    });
    if (!row) {
      throw new NotFoundException({
        error: 'request_not_found',
        message: 'Запит уже не існує',
      });
    }
    return row;
  }

  async acceptRequest(me: string, id: string): Promise<FriendsOverviewDto> {
    const row = await this.findRequest(id);
    if (row.addresseeId !== me) {
      throw new ForbiddenException({
        error: 'not_addressee',
        message: 'Прийняти запит може лише той, кому його надіслали',
      });
    }
    if (row.status === FriendshipStatus.ACCEPTED) return this.overview(me);
    row.status = FriendshipStatus.ACCEPTED;
    row.respondedAt = new Date();
    await this.friendships.save(row);
    await this.notifications.resolveByRef(
      row.id,
      FRIEND_REQUEST_TYPES,
      NotificationStatus.ACCEPTED,
    );
    await this.notifications.create({
      playerId: row.requesterId,
      type: NotificationType.FRIEND_REQUEST_ACCEPTED,
      refId: row.id,
      actor: row.addressee,
    });
    this.events.playersChanged([row.requesterId, row.addresseeId]);
    this.logger.log(`friend request ${row.id} accepted by ${me}`);
    return this.overview(me);
  }

  async declineRequest(me: string, id: string): Promise<FriendsOverviewDto> {
    const row = await this.findRequest(id);
    if (row.addresseeId !== me) {
      throw new ForbiddenException({
        error: 'not_addressee',
        message: 'Відхилити запит може лише той, кому його надіслали',
      });
    }
    if (row.status !== FriendshipStatus.PENDING) {
      throw new ConflictException({
        error: 'request_not_pending',
        message: 'Запит уже не чекає на відповідь',
      });
    }
    await this.friendships.delete({ id: row.id });
    await this.notifications.resolveByRef(
      row.id,
      FRIEND_REQUEST_TYPES,
      NotificationStatus.DECLINED,
    );
    this.events.playersChanged([row.requesterId, row.addresseeId]);
    return this.overview(me);
  }

  /** Requester withdraws their own open request. */
  async cancelRequest(me: string, id: string): Promise<FriendsOverviewDto> {
    const row = await this.findRequest(id);
    if (row.requesterId !== me) {
      throw new ForbiddenException({
        error: 'not_requester',
        message: 'Скасувати запит може лише його автор',
      });
    }
    if (row.status !== FriendshipStatus.PENDING) {
      throw new ConflictException({
        error: 'request_not_pending',
        message: 'Запит уже прийнято',
      });
    }
    await this.friendships.delete({ id: row.id });
    await this.notifications.resolveByRef(
      row.id,
      FRIEND_REQUEST_TYPES,
      NotificationStatus.CANCELLED,
    );
    this.events.playersChanged([row.requesterId, row.addresseeId]);
    return this.overview(me);
  }

  async removeFriend(
    me: string,
    playerId: string,
  ): Promise<FriendsOverviewDto> {
    const row = await this.findPair(me, playerId);
    if (!row || row.status !== FriendshipStatus.ACCEPTED) {
      throw new NotFoundException({
        error: 'not_friends',
        message: 'Цього гравця немає у ваших друзях',
      });
    }
    await this.friendships.delete({ id: row.id });
    this.events.playersChanged([me, playerId]);
    this.logger.log(`friendship ${row.id} removed by ${me}`);
    return this.overview(me);
  }
}
