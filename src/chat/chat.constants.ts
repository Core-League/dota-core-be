/** Socket.io namespace of the site chat: `<api>/chat`. */
export const CHAT_SOCKET_NAMESPACE = '/chat';

/**
 * Kind of a chat channel. Public kinds have one channel each; `admin` is one
 * support thread per player, `dm` one thread per unordered pair of players.
 */
export enum ChatChannelKind {
  GENERAL = 'general',
  CAPTAINS = 'captains',
  DUEL = 'duel',
  ADMIN = 'admin',
  DM = 'dm',
}

/** Channels everyone with access shares; the weekly retention job cleans exactly these. */
export const CHAT_PUBLIC_KINDS: readonly ChatChannelKind[] = [
  ChatChannelKind.GENERAL,
  ChatChannelKind.CAPTAINS,
  ChatChannelKind.DUEL,
];

export const CHAT_MESSAGE_MAX_LENGTH = 1000;
export const CHAT_HISTORY_DEFAULT_LIMIT = 50;
export const CHAT_HISTORY_MAX_LIMIT = 100;
export const CHAT_MENTIONS_MAX = 10;
export const CHAT_PLAYER_SEARCH_LIMIT = 10;
/** Suggestions before anything is typed: friends + online players. */
export const CHAT_PLAYER_SUGGEST_LIMIT = 20;
/** Non-admins may tag everyone online with `@online` once per this window. */
export const CHAT_ONLINE_MENTION_COOLDOWN_MS = 5 * 60_000;

/** `@online` as a separate word (start / whitespace before, end / whitespace / punctuation after). */
const ONLINE_MENTION_RE = /(^|\s)@online(?=$|[\s.,!?;:)\]}»"'])/iu;

/** Whether the body uses the `@online` command (public channels only — checked by the caller). */
export function hasOnlineMention(body: string): boolean {
  return ONLINE_MENTION_RE.test(body);
}
/** Presence watch list of one socket (PM tabs + admin thread list). */
export const CHAT_PRESENCE_WATCH_MAX = 200;

/** Token bucket per player: up to `burst` messages at once, refilled at `refillPerSecond`. */
export const CHAT_RATE_LIMIT = { burst: 5, refillPerSecond: 1 } as const;
/** Minimum gap between two forwarded typing events of one player in one channel. */
export const CHAT_TYPING_THROTTLE_MS = 1_500;
/** A player whose last socket closed stays "online" this long (page reloads, flaky mobile networks). */
export const CHAT_PRESENCE_GRACE_MS = 5_000;
/** Access (admin / captain) cached on the socket; team and role changes refresh it immediately. */
export const CHAT_ACCESS_CACHE_MS = 60_000;

/** Public-channel messages older than this are removed by `ChatRetentionScheduler`. */
export const CHAT_RETENTION_DAYS = 7;
/** Every Sunday at 23:59 (Kyiv time, regardless of the server time zone). */
export const CHAT_RETENTION_CRON = '59 23 * * 0';
export const CHAT_RETENTION_TIME_ZONE = 'Europe/Kyiv';

/**
 * Role names that make a player read-only in the chat. The role catalog has
 * no "blocked" role yet (the frontend only labels one), so this matches
 * nothing today and starts working once such a role is added.
 */
export const CHAT_READ_ONLY_ROLE_NAMES: readonly string[] = [
  'blocked',
  'Заблокований',
];

/** Socket.io rooms of the chat namespace (the per-player `player:<id>` room comes from socket-auth). */
export const CHAT_ROOMS = {
  general: 'chat:general',
  captains: 'chat:captains',
  duel: 'chat:duel',
  /** Every connected admin: receives all admin threads. */
  admins: 'chat:admins',
} as const;

export const CHAT_PUBLIC_ROOM: Record<string, string> = {
  [ChatChannelKind.GENERAL]: CHAT_ROOMS.general,
  [ChatChannelKind.CAPTAINS]: CHAT_ROOMS.captains,
  [ChatChannelKind.DUEL]: CHAT_ROOMS.duel,
};

/** Server → client events. Mirrored by `IChatSocketServerEvents` on the frontend. */
export const CHAT_EVENTS = {
  access: 'chat:access',
  message: 'chat:message',
  messageDeleted: 'chat:message-deleted',
  unread: 'chat:unread',
  read: 'chat:read',
  typing: 'chat:typing',
  presence: 'chat:presence',
  purged: 'chat:purged',
  error: 'chat:error',
} as const;

/** Client → server events (answered through the socket.io ack). */
export const CHAT_COMMANDS = {
  send: 'chat:send',
  delete: 'chat:delete',
  typing: 'chat:typing',
  read: 'chat:read',
  watchPresence: 'chat:watch-presence',
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function adminThreadKey(ownerId: string): string {
  return `${ChatChannelKind.ADMIN}:${ownerId.toLowerCase()}`;
}

/** Both sides of a pair share one key: ids are lower-cased and sorted. */
export function directKey(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${ChatChannelKind.DM}:${x}:${y}`;
}

export type ChatChannelRef =
  | {
      key: string;
      kind:
        | ChatChannelKind.GENERAL
        | ChatChannelKind.CAPTAINS
        | ChatChannelKind.DUEL;
      participantIds: [];
    }
  | { key: string; kind: ChatChannelKind.ADMIN; participantIds: [string] }
  | {
      key: string;
      kind: ChatChannelKind.DM;
      participantIds: [string, string];
    };

const KIND_BY_PREFIX: Record<string, ChatChannelKind | undefined> = {
  general: ChatChannelKind.GENERAL,
  captains: ChatChannelKind.CAPTAINS,
  duel: ChatChannelKind.DUEL,
  admin: ChatChannelKind.ADMIN,
  dm: ChatChannelKind.DM,
};

/** Validates a channel key from a client; returns its canonical form or null. */
export function parseChannelKey(raw: unknown): ChatChannelRef | null {
  if (typeof raw !== 'string' || raw.length > 96) return null;
  const parts = raw.split(':');
  const kind = KIND_BY_PREFIX[parts[0]];
  switch (kind) {
    case ChatChannelKind.GENERAL:
    case ChatChannelKind.CAPTAINS:
    case ChatChannelKind.DUEL:
      return parts.length === 1
        ? { key: kind, kind, participantIds: [] }
        : null;
    case ChatChannelKind.ADMIN:
      return parts.length === 2 && isUuid(parts[1])
        ? {
            key: adminThreadKey(parts[1]),
            kind: ChatChannelKind.ADMIN,
            participantIds: [parts[1].toLowerCase()],
          }
        : null;
    case ChatChannelKind.DM: {
      if (parts.length !== 3 || !isUuid(parts[1]) || !isUuid(parts[2])) {
        return null;
      }
      const [x, y] = [parts[1].toLowerCase(), parts[2].toLowerCase()].sort();
      if (x === y) return null;
      return {
        key: directKey(x, y),
        kind: ChatChannelKind.DM,
        participantIds: [x, y],
      };
    }
    default:
      return null;
  }
}

export function isPublicKind(kind: string): boolean {
  return (CHAT_PUBLIC_KINDS as readonly string[]).includes(kind);
}
