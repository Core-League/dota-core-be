import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, type Repository } from 'typeorm';
import { FriendshipStatus } from '../friends/friends.constants';
import { Player } from '../players/player.entity';
import { ChatAccessService, type ChatViewer } from './chat-access.service';
import { ChatMessage } from './chat-message.entity';
import {
  CHAT_HISTORY_DEFAULT_LIMIT,
  CHAT_HISTORY_MAX_LIMIT,
  CHAT_MENTIONS_MAX,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_PLAYER_SEARCH_LIMIT,
  CHAT_PLAYER_SUGGEST_LIMIT,
  CHAT_PUBLIC_KINDS,
  CHAT_RETENTION_DAYS,
  ChatChannelKind,
  hasOnlineMention,
  isPublicKind,
  isUuid,
  parseChannelKey,
  type ChatChannelRef,
} from './chat.constants';
import type {
  ChatAdminThreadDto,
  ChatHistoryDto,
  ChatMessageDto,
  ChatPlayerDto,
  ChatUnreadChannelDto,
} from './dto/chat.dto';

export type ChatErrorCode =
  | 'unauthorized'
  | 'invalid_channel'
  | 'forbidden'
  | 'read_only'
  | 'empty'
  | 'too_long'
  | 'rate_limited'
  | 'not_found';

/** Domain error of the chat; the gateway acks it, the controller maps it to HTTP. */
export class ChatError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ChatSendInput {
  channelKey: unknown;
  body: unknown;
  mentions?: unknown;
  /**
   * Trusted, from the gateway: players connected to the channel right now.
   * Tagged only when the body really uses `@online` in a public channel.
   */
  onlinePlayerIds?: string[];
}

/** What the gateway needs to fan a change out: the channel and its private owners. */
export interface ChatAudience {
  channelKey: string;
  channelKind: ChatChannelKind;
  participantIds: string[];
}

export interface ChatUnreadSummary {
  channels: ChatUnreadChannelDto[];
  /** Admins only: keys of admin threads with unread messages from their owners. */
  adminUnreadThreadKeys: string[];
}

const ADMIN_THREADS_LIMIT = 200;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function displayNames(p: {
  discordName: string | null;
  discordUsername: string | null;
}): string[] {
  return [p.discordName, p.discordUsername]
    .filter((n): n is string => !!n && !!n.trim())
    .map((n) => n.trim().toLowerCase());
}

/**
 * Messages, history, read markers and the retention purge of the site chat.
 * Access is decided by `ChatAccessService`; fan-out is the gateway's job.
 */
@Injectable()
export class ChatService {
  private readonly messages: Repository<ChatMessage>;
  private readonly players: Repository<Player>;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatAccessService,
  ) {
    this.messages = dataSource.getRepository(ChatMessage);
    this.players = dataSource.getRepository(Player);
  }

  parseChannel(raw: unknown): ChatChannelRef {
    const channel = parseChannelKey(raw);
    if (!channel) throw new ChatError('invalid_channel', 'Невідомий канал');
    return channel;
  }

  assertCanRead(viewer: ChatViewer | null, channel: ChatChannelRef): void {
    if (this.access.canRead(viewer, channel)) return;
    if (!viewer) {
      throw new ChatError('unauthorized', 'Увійдіть, щоб читати цей канал');
    }
    throw new ChatError('forbidden', 'Немає доступу до цього каналу');
  }

  // ── messages ─────────────────────────────────────────────────────────────

  async send(
    viewer: ChatViewer | null,
    input: ChatSendInput,
  ): Promise<ChatMessageDto> {
    if (!viewer) {
      throw new ChatError('unauthorized', 'Увійдіть, щоб писати в чат');
    }
    const channel = this.parseChannel(input.channelKey);
    this.assertCanRead(viewer, channel);
    if (!this.access.canWrite(viewer, channel)) {
      throw new ChatError('read_only', 'Ви можете лише читати чат');
    }

    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!body) throw new ChatError('empty', 'Порожнє повідомлення');
    if (body.length > CHAT_MESSAGE_MAX_LENGTH) {
      throw new ChatError(
        'too_long',
        `Повідомлення довше за ${CHAT_MESSAGE_MAX_LENGTH} символів`,
      );
    }

    if (channel.kind !== ChatChannelKind.GENERAL) {
      await this.assertParticipantsExist(channel);
    }
    const mentionedPlayerIds = isPublicKind(channel.kind)
      ? await this.resolveMentions(viewer, channel, body, input.mentions)
      : [];
    const onlineMentionIds =
      isPublicKind(channel.kind) && hasOnlineMention(body)
        ? [...new Set(input.onlinePlayerIds ?? [])].filter(
            (id) => id !== viewer.playerId,
          )
        : [];

    const saved = await this.messages.save(
      this.messages.create({
        channelKey: channel.key,
        channelKind: channel.kind,
        authorId: viewer.playerId,
        body,
        participantIds: [...channel.participantIds],
        mentionedPlayerIds,
        onlineMentionIds,
      }),
    );
    const [dto] = await this.toDtos([saved]);
    return dto;
  }

  async history(
    viewer: ChatViewer | null,
    rawChannel: unknown,
    before?: string,
    limit = CHAT_HISTORY_DEFAULT_LIMIT,
  ): Promise<ChatHistoryDto> {
    const channel = this.parseChannel(rawChannel);
    this.assertCanRead(viewer, channel);
    const take = Math.min(Math.max(1, limit), CHAT_HISTORY_MAX_LIMIT);

    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.channelKey = :key', { key: channel.key })
      .andWhere('m.deletedAt IS NULL')
      .orderBy('m.createdAt', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .limit(take + 1);
    if (before) {
      const cursor = new Date(before);
      if (!Number.isNaN(cursor.getTime())) {
        qb.andWhere('m.createdAt < :before', { before: cursor });
      }
    }
    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    const page = rows.slice(0, take).reverse();
    return { items: await this.toDtos(page), hasMore };
  }

  /** Admins remove messages of public channels; the row stays until the retention purge. */
  async remove(
    viewer: ChatViewer | null,
    messageId: unknown,
  ): Promise<ChatAudience & { id: string }> {
    if (!viewer?.isAdmin) {
      throw new ChatError(
        'forbidden',
        'Видаляти повідомлення може лише адміністратор',
      );
    }
    if (!isUuid(messageId)) {
      throw new ChatError('not_found', 'Повідомлення не знайдено');
    }
    const message = await this.messages.findOne({ where: { id: messageId } });
    if (!message || message.deletedAt) {
      throw new ChatError('not_found', 'Повідомлення не знайдено');
    }
    if (!isPublicKind(message.channelKind)) {
      throw new ChatError(
        'forbidden',
        'Видаляти можна лише повідомлення загальних каналів',
      );
    }
    await this.messages.update(
      { id: message.id },
      { deletedAt: new Date(), deletedById: viewer.playerId },
    );
    return {
      id: message.id,
      channelKey: message.channelKey,
      channelKind: message.channelKind,
      participantIds: message.participantIds,
    };
  }

  // ── read markers & unread ────────────────────────────────────────────────

  /** Moves the marker forward (never back) to `upTo` (clamped to now); returns the stored value. */
  async markRead(
    viewer: ChatViewer,
    rawChannel: unknown,
    upTo?: unknown,
  ): Promise<{ channelKey: string; lastReadAt: Date }> {
    const channel = this.parseChannel(rawChannel);
    this.assertCanRead(viewer, channel);
    const now = new Date();
    let at = now;
    if (typeof upTo === 'string') {
      const parsed = new Date(upTo);
      if (!Number.isNaN(parsed.getTime()) && parsed < now) at = parsed;
    }
    const rows: { lastReadAt: Date }[] = await this.dataSource.query(
      `INSERT INTO "chat_read_marker" ("playerId", "channelKey", "lastReadAt")
       VALUES ($1, $2, $3)
       ON CONFLICT ("playerId", "channelKey")
       DO UPDATE SET "lastReadAt" = GREATEST("chat_read_marker"."lastReadAt", EXCLUDED."lastReadAt")
       RETURNING "lastReadAt"`,
      [viewer.playerId, channel.key, at],
    );
    return { channelKey: channel.key, lastReadAt: rows[0]?.lastReadAt ?? at };
  }

  async unreadSummary(viewer: ChatViewer): Promise<ChatUnreadSummary> {
    const snapshot = this.access.snapshot(viewer);
    const publicKinds = CHAT_PUBLIC_KINDS.filter(
      (kind) => kind !== ChatChannelKind.CAPTAINS || snapshot.canCaptains,
    );
    const rows: {
      channelKey: string;
      channelKind: ChatChannelKind;
      unread: number;
      mentions: number;
    }[] = await this.dataSource.query(
      `SELECT m."channelKey", m."channelKind",
              COUNT(*)::int AS "unread",
              COUNT(*) FILTER (
                WHERE $1::uuid = ANY(m."mentionedPlayerIds") OR $1::uuid = ANY(m."onlineMentionIds")
              )::int AS "mentions"
         FROM "chat_message" m
         LEFT JOIN "chat_read_marker" r
           ON r."playerId" = $1 AND r."channelKey" = m."channelKey"
        WHERE m."deletedAt" IS NULL
          AND m."authorId" <> $1
          AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
          AND (m."channelKind" = ANY($2::varchar[]) OR m."participantIds" @> ARRAY[$1]::uuid[])
        GROUP BY m."channelKey", m."channelKind"`,
      [viewer.playerId, publicKinds],
    );

    const peerIds = rows
      .map((r) => parseChannelKey(r.channelKey))
      .filter((c): c is ChatChannelRef => c?.kind === ChatChannelKind.DM)
      .flatMap((c) => c.participantIds)
      .filter((id) => id !== viewer.playerId);
    const peers = await this.loadPlayers(peerIds);

    const channels = rows.map((r): ChatUnreadChannelDto => {
      const channel = parseChannelKey(r.channelKey);
      const peerId =
        channel?.kind === ChatChannelKind.DM
          ? channel.participantIds.find((id) => id !== viewer.playerId)
          : undefined;
      return {
        channelKey: r.channelKey,
        channelKind: r.channelKind,
        unread: r.unread,
        mentions: r.mentions,
        peer: (peerId && peers.get(peerId)) || null,
      };
    });

    let adminUnreadThreadKeys: string[] = [];
    if (viewer.isAdmin) {
      const keys: { channelKey: string }[] = await this.dataSource.query(
        `SELECT DISTINCT m."channelKey"
           FROM "chat_message" m
           LEFT JOIN "chat_read_marker" r
             ON r."playerId" = $1 AND r."channelKey" = m."channelKey"
          WHERE m."channelKind" = 'admin'
            AND m."deletedAt" IS NULL
            AND m."authorId" = m."participantIds"[1]
            AND m."authorId" <> $1
            AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
          LIMIT $2`,
        [viewer.playerId, ADMIN_THREADS_LIMIT],
      );
      adminUnreadThreadKeys = keys.map((k) => k.channelKey);
    }
    return { channels, adminUnreadThreadKeys };
  }

  /** Admin tab of an admin: every support thread, latest activity first. */
  async adminThreads(viewer: ChatViewer): Promise<ChatAdminThreadDto[]> {
    if (!viewer.isAdmin) {
      throw new ChatError('forbidden', 'Лише для адміністраторів');
    }
    const rows: { id: string; unread: number }[] = await this.dataSource.query(
      `WITH "last" AS (
         SELECT DISTINCT ON (m."channelKey") m."id", m."channelKey", m."createdAt"
           FROM "chat_message" m
          WHERE m."channelKind" = 'admin' AND m."deletedAt" IS NULL
          ORDER BY m."channelKey", m."createdAt" DESC
       ), "unread" AS (
         SELECT m."channelKey", COUNT(*)::int AS "unread"
           FROM "chat_message" m
           LEFT JOIN "chat_read_marker" r
             ON r."playerId" = $1 AND r."channelKey" = m."channelKey"
          WHERE m."channelKind" = 'admin'
            AND m."deletedAt" IS NULL
            AND m."authorId" = m."participantIds"[1]
            AND m."authorId" <> $1
            AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
          GROUP BY m."channelKey"
       )
       SELECT "last"."id", COALESCE("unread"."unread", 0)::int AS "unread"
         FROM "last" LEFT JOIN "unread" USING ("channelKey")
        ORDER BY "last"."createdAt" DESC
        LIMIT $2`,
      [viewer.playerId, ADMIN_THREADS_LIMIT],
    );
    if (!rows.length) return [];
    const messages = await this.messages.findBy({
      id: In(rows.map((r) => r.id)),
    });
    const dtos = new Map(
      (await this.toDtos(messages)).map((dto) => [dto.id, dto]),
    );
    return rows.flatMap((row): ChatAdminThreadDto[] => {
      const lastMessage = dtos.get(row.id);
      if (!lastMessage?.threadOwner) return [];
      return [
        {
          channelKey: lastMessage.channelKey,
          owner: lastMessage.threadOwner,
          lastMessage,
          unread: row.unread,
        },
      ];
    });
  }

  // ── players ──────────────────────────────────────────────────────────────

  /**
   * New-PM search and mention autocomplete; `channel` narrows to players who can read it.
   * Empty `q`: the caller's friends and players online right now (`onlineIds`, from the
   * gateway) — never the whole player table. With `q`: every player whose Discord name /
   * username contains it; name-prefix matches first, then friends, then online players.
   */
  async searchPlayers(
    viewer: ChatViewer,
    q?: string,
    rawChannel?: string,
    onlineIds: string[] = [],
  ): Promise<ChatPlayerDto[]> {
    const params: unknown[] = [
      viewer.playerId,
      FriendshipStatus.ACCEPTED,
      onlineIds.filter(isUuid),
    ];
    const param = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const isFriend = `EXISTS (
      SELECT 1 FROM "friendship" f
       WHERE f."status" = $2
         AND ((f."requesterId" = $1 AND f."addresseeId" = p."id")
           OR (f."addresseeId" = $1 AND f."requesterId" = p."id")))`;
    const isOnline = `p."id" = ANY($3::uuid[])`;

    const where = [`p."id" <> $1`];
    const order: string[] = [];
    const term = q?.trim();
    if (term) {
      const contains = param(`%${escapeLike(term)}%`);
      const prefix = param(`${escapeLike(term)}%`);
      where.push(
        `(p."discordName" ILIKE ${contains} ESCAPE '\\' OR p."discordUsername" ILIKE ${contains} ESCAPE '\\')`,
      );
      order.push(
        `(p."discordName" ILIKE ${prefix} ESCAPE '\\' OR p."discordUsername" ILIKE ${prefix} ESCAPE '\\') DESC`,
      );
    } else {
      where.push(`(${isFriend} OR ${isOnline})`);
    }
    order.push(
      `${isFriend} DESC`,
      `${isOnline} DESC`,
      `p."discordName" ASC NULLS LAST`,
    );

    if (rawChannel) {
      const channel = this.parseChannel(rawChannel);
      if (channel.kind === ChatChannelKind.CAPTAINS) {
        where.push(
          `(EXISTS (SELECT 1 FROM "team" t WHERE t."captainId" = p."id" AND t."disbandedAt" IS NULL)
            OR EXISTS (SELECT 1 FROM "user_roles" ur WHERE ur."playerId" = p."id" AND ur."isAdminRole"))`,
        );
      } else if (channel.kind === ChatChannelKind.DM) {
        where.push(`p."id" = ANY(${param(channel.participantIds)}::uuid[])`);
      } else if (channel.kind === ChatChannelKind.ADMIN) {
        where.push(`p."id" = ${param(channel.participantIds[0])}`);
      }
    }

    const limit = param(
      term ? CHAT_PLAYER_SEARCH_LIMIT : CHAT_PLAYER_SUGGEST_LIMIT,
    );
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT p."id" FROM "player" p
        WHERE ${where.join(' AND ')}
        ORDER BY ${order.join(', ')}
        LIMIT ${limit}`,
      params,
    );
    const players = await this.loadPlayers(rows.map((r) => r.id));
    return rows.flatMap((r) => players.get(r.id) ?? []);
  }

  // ── retention ────────────────────────────────────────────────────────────

  /** Hard-deletes public-channel messages older than the retention window. */
  async purgeOldPublicMessages(
    now = new Date(),
  ): Promise<{ deleted: number; before: Date }> {
    const before = new Date(
      now.getTime() - CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const result = await this.messages
      .createQueryBuilder()
      .delete()
      .from(ChatMessage)
      .where('"channelKind" IN (:...kinds)', { kinds: [...CHAT_PUBLIC_KINDS] })
      .andWhere('"createdAt" < :before', { before })
      .execute();
    return { deleted: result.affected ?? 0, before };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async assertParticipantsExist(
    channel: ChatChannelRef,
  ): Promise<void> {
    if (!channel.participantIds.length) return;
    const count = await this.players.count({
      where: { id: In([...channel.participantIds]) },
    });
    if (count !== channel.participantIds.length) {
      throw new ChatError('not_found', 'Гравця не знайдено');
    }
  }

  /**
   * Keeps only mentions that really appear as `@<name>` in the body and
   * whose player can read the channel (captains channel: captains + admins).
   */
  private async resolveMentions(
    viewer: ChatViewer,
    channel: ChatChannelRef,
    body: string,
    raw: unknown,
  ): Promise<string[]> {
    if (!Array.isArray(raw)) return [];
    const ids = [
      ...new Set(
        raw
          .filter(isUuid)
          .map((id) => id.toLowerCase())
          .filter((id) => id !== viewer.playerId),
      ),
    ].slice(0, CHAT_MENTIONS_MAX);
    if (!ids.length) return [];

    const lowerBody = body.toLowerCase();
    const candidates = await this.players.find({
      where: { id: In(ids) },
      relations: ['roles'],
    });
    let captainIds = new Set<string>();
    if (channel.kind === ChatChannelKind.CAPTAINS) {
      const rows: { captainId: string }[] = await this.dataSource.query(
        `SELECT DISTINCT "captainId" FROM "team" WHERE "disbandedAt" IS NULL AND "captainId" = ANY($1::uuid[])`,
        [ids],
      );
      captainIds = new Set(rows.map((r) => r.captainId));
    }
    return candidates
      .filter((p) => {
        if (channel.kind === ChatChannelKind.CAPTAINS) {
          const isAdmin = (p.roles ?? []).some((r) => r.isAdminRole);
          if (!isAdmin && !captainIds.has(p.id)) return false;
        }
        return displayNames(p).some((name) => lowerBody.includes(`@${name}`));
      })
      .map((p) => p.id);
  }

  private async loadPlayers(
    ids: string[],
  ): Promise<Map<string, ChatPlayerDto>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.players.find({
      where: { id: In(unique) },
      relations: ['roles'],
    });
    return new Map(
      rows.map((p) => [
        p.id,
        {
          id: p.id,
          discordName: p.discordName,
          discordUsername: p.discordUsername,
          avatarUrl: p.avatarUrl,
          isAdmin: (p.roles ?? []).some((r) => r.isAdminRole),
        },
      ]),
    );
  }

  async toDtos(messages: ChatMessage[]): Promise<ChatMessageDto[]> {
    const players = await this.loadPlayers(
      messages.flatMap((m) => [
        m.authorId,
        ...m.mentionedPlayerIds,
        ...m.participantIds,
      ]),
    );
    const unknown = (id: string): ChatPlayerDto => ({
      id,
      discordName: null,
      discordUsername: null,
      avatarUrl: null,
      isAdmin: false,
    });
    const card = (id: string) => players.get(id) ?? unknown(id);
    return messages.map((m) => ({
      id: m.id,
      channelKey: m.channelKey,
      channelKind: m.channelKind,
      author: card(m.authorId),
      body: m.body,
      mentions: m.mentionedPlayerIds.flatMap((id) => players.get(id) ?? []),
      onlineMentionIds: m.onlineMentionIds ?? [],
      threadOwner:
        m.channelKind === ChatChannelKind.ADMIN && m.participantIds[0]
          ? card(m.participantIds[0])
          : null,
      participants:
        m.channelKind === ChatChannelKind.DM
          ? m.participantIds.map(card)
          : null,
      createdAt: m.createdAt,
    }));
  }
}
