import { join } from 'node:path';
import * as protobuf from 'protobufjs';

/**
 * Dota 2 Game Coordinator wire protocol: the Valve `.proto` files vendored in
 * ./protobufs (see VERSION.txt for the GameTracking-Dota2 commit), loaded once
 * with protobufjs, plus the handful of message ids and enums the host bot
 * needs. Everything the bot sends or receives goes through `encode` / `decode`.
 */

export const DOTA_APP_ID = 570;

/** GC SDK client messages (gcsystemmsgs.proto). */
export const EGCBaseClientMsg = {
  ClientWelcome: 4004,
  ClientHello: 4006,
  ClientConnectionStatus: 4009,
} as const;

/** Shared-object cache messages (gcsdk). */
export const ESOMsg = {
  Create: 21,
  Update: 22,
  Destroy: 23,
  CacheSubscribed: 24,
  CacheUnsubscribed: 25,
  UpdateMultiple: 26,
} as const;

/** Dota messages (dota_gcmessages_msgid.proto + base_gcmessages.proto). */
export const EDOTAGCMsg = {
  PracticeLobbyCreate: 7038,
  PracticeLobbyLeave: 7040,
  PracticeLobbyLaunch: 7041,
  PracticeLobbySetTeamSlot: 7047,
  PracticeLobbyKick: 7081,
  InviteToLobby: 4512,
} as const;

/**
 * Shared-object type id of `CSODOTALobby`. Valve no longer publishes the
 * `ESOType` enum; every client library (ValvePython/dota2, node-dota2) uses
 * 2004 and the bot logs any other type id it sees at debug level.
 */
export const SO_TYPE_LOBBY = 2004;

export const GCConnectionStatus = {
  HAVE_SESSION: 0,
  GC_GOING_DOWN: 1,
  NO_SESSION: 2,
  NO_SESSION_IN_LOGON_QUEUE: 3,
  NO_STEAM: 4,
  SUSPENDED: 5,
  STEAM_GOING_DOWN: 6,
} as const;

export const DOTA_GC_TEAM = {
  GOOD_GUYS: 0,
  BAD_GUYS: 1,
  BROADCASTER: 2,
  SPECTATOR: 3,
  PLAYER_POOL: 4,
  NOTEAM: 5,
} as const;

export const LobbyState = {
  UI: 0,
  SERVERSETUP: 1,
  RUN: 2,
  POSTGAME: 3,
  READYUP: 4,
  NOTREADY: 5,
  SERVERASSIGN: 6,
} as const;

export const DOTA_GAMEMODE_1V1MID = 21;
export const LOBBY_VISIBILITY_UNLISTED = 2;
export const ESE_SOURCE2 = 1;

/** Shape of a decoded `CSODOTALobbyMember` (fields we read). */
export interface GcLobbyMember {
  id: string; // steamId64
  team: number;
  slot?: number;
  hero_id?: number;
}

/** Shape of a decoded `CSODOTALobby` (fields we read). */
export interface GcLobby {
  lobby_id: string;
  leader_id?: string;
  server_id?: string;
  state: number;
  game_mode?: number;
  match_id?: string;
  match_outcome?: number;
  all_members: GcLobbyMember[];
  pass_key?: string;
  game_name?: string;
}

const PROTO_DIR = join(__dirname, 'protobufs');

const PROTO_FILES = [
  'gcsystemmsgs.proto',
  'gcsdk_gcmessages.proto',
  'base_gcmessages.proto',
  'dota_shared_enums.proto',
  'dota_gcmessages_common_lobby.proto',
  'dota_gcmessages_client_match_management.proto',
  'dota_gcmessages_msgid.proto',
];

let cachedRoot: protobuf.Root | null = null;

export function loadProtocol(): protobuf.Root {
  if (cachedRoot) return cachedRoot;
  const root = new protobuf.Root();
  root.resolvePath = (_origin: string, target: string) =>
    target.startsWith('google/protobuf/')
      ? join(PROTO_DIR, target)
      : join(PROTO_DIR, target.split(/[\\/]/).pop() ?? target);
  root.loadSync(PROTO_FILES, { keepCase: true });
  cachedRoot = root;
  return root;
}

const DECODE_OPTIONS: protobuf.IConversionOptions = {
  longs: String,
  enums: Number,
  bytes: Buffer,
  defaults: false,
  arrays: true,
};

export function encode(
  typeName: string,
  payload: Record<string, unknown>,
): Buffer {
  const type = loadProtocol().lookupType(typeName);
  // fromObject converts strings to Long for (u)int64 / fixed64 fields; verify
  // must run on the converted message, not on the raw payload.
  const message = type.fromObject(payload);
  const err = type.verify(message);
  if (err) throw new Error(`${typeName}: ${err}`);
  return Buffer.from(type.encode(message).finish());
}

export function decode<T = Record<string, unknown>>(
  typeName: string,
  buffer: Buffer | Uint8Array,
): T {
  const type = loadProtocol().lookupType(typeName);
  const message = type.decode(buffer);
  return type.toObject(message, DECODE_OPTIONS) as T;
}

// ── Steam id helpers ───────────────────────────────────────────────────────

const STEAM_ID_OFFSET = 76561197960265728n;

/** Lower 32 bits of a SteamID64 — what the Game Coordinator calls `account_id`. */
export function accountIdOf(steamId64: string | number | bigint): number {
  return Number(BigInt(steamId64) & 0xffffffffn);
}

export function steamId64Of(accountId: number): string {
  return (BigInt(accountId) + STEAM_ID_OFFSET).toString();
}
