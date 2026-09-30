import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

/** Shape shared by every authenticated gateway: `socket.data.playerId` after the handshake. */
export type PlayerSocket = Socket<any, any, any, { playerId?: string }>;

export const playerRoom = (playerId: string) => `player:${playerId}`;

/** `auth: { token }` (socket.io-client), or a bearer header / `?token=` for other clients. */
export function extractSocketToken(client: PlayerSocket): string | null {
  const auth = client.handshake.auth as Record<string, unknown> | undefined;
  if (typeof auth?.token === 'string' && auth.token) return auth.token;
  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || null;
  }
  const query = client.handshake.query.token;
  return typeof query === 'string' && query ? query : null;
}

/**
 * Same bearer JWT as the REST API. Access tokens carry no `typ`; OAuth-state /
 * Steam-link tokens do and are not logins. Returns the player id or null.
 */
export async function authenticateSocket(
  client: PlayerSocket,
  jwt: JwtService,
): Promise<string | null> {
  const token = extractSocketToken(client);
  if (!token) return null;
  try {
    const payload = await jwt.verifyAsync<JwtPayload>(token);
    if (payload.typ) return null;
    return payload.sub || null;
  } catch {
    return null;
  }
}
