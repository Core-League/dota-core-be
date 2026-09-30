/**
 * Change notifications of the 1v1 ladder. Every write that changes what a
 * player sees on the duels page publishes one of these on the Postgres
 * channel `duel_events` (`pg_notify`), because the writes happen in two
 * processes — api-v1 (HTTP, matchmaker) and the bot-worker — while only
 * api-v1 holds the players' sockets. `DuelEventsListener` turns them back
 * into socket pushes. The notification center rides the same channel
 * (`scope: 'notification'`) so one LISTEN connection serves both gateways.
 */

export const DUEL_EVENTS_CHANNEL = 'duel_events';

export type DuelEvent =
  /** Queue membership changed: everyone in the queue sees a new count / pairing. */
  | { scope: 'queue' }
  /** One duel changed — its two players get a fresh status. */
  | { scope: 'duel'; duelId: string }
  /** Something else about these players changed (rating edit, cooldown, challenge, …). */
  | { scope: 'players'; playerIds: string[] }
  /** Host-bot pool changed: `bots` + `canQueue` in every status. */
  | { scope: 'bots' }
  /** These players' inboxes changed: the `/notifications` gateway pushes a new snapshot. */
  | { scope: 'notification'; playerIds: string[] };

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((p): p is string => typeof p === 'string')
    : [];
}

export function parseDuelEvent(payload: string): DuelEvent | null {
  try {
    const raw: unknown = JSON.parse(payload);
    if (!raw || typeof raw !== 'object') return null;
    const e = raw as Record<string, unknown>;
    switch (e.scope) {
      case 'queue':
      case 'bots':
        return { scope: e.scope };
      case 'duel':
        return typeof e.duelId === 'string'
          ? { scope: 'duel', duelId: e.duelId }
          : null;
      case 'players':
        return Array.isArray(e.playerIds)
          ? { scope: 'players', playerIds: stringIds(e.playerIds) }
          : null;
      case 'notification':
        return Array.isArray(e.playerIds)
          ? { scope: 'notification', playerIds: stringIds(e.playerIds) }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
