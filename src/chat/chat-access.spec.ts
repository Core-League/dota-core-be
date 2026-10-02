import type { DataSource } from 'typeorm';
import { ChatAccessService, type ChatViewer } from './chat-access.service';
import {
  ChatChannelKind,
  directKey,
  parseChannelKey,
  type ChatChannelRef,
} from './chat.constants';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function viewer(patch: Partial<ChatViewer> = {}): ChatViewer {
  return {
    playerId: A,
    isAdmin: false,
    isCaptain: false,
    readOnly: false,
    ...patch,
  };
}

function channel(key: string): ChatChannelRef {
  const parsed = parseChannelKey(key);
  if (!parsed) throw new Error(`bad key ${key}`);
  return parsed;
}

describe('parseChannelKey', () => {
  it('accepts public channels and rejects suffixes', () => {
    expect(parseChannelKey('general')?.kind).toBe(ChatChannelKind.GENERAL);
    expect(parseChannelKey('duel')?.kind).toBe(ChatChannelKind.DUEL);
    expect(parseChannelKey('general:x')).toBeNull();
    expect(parseChannelKey('random')).toBeNull();
    expect(parseChannelKey(42)).toBeNull();
  });

  it('canonicalises DM keys so both sides share one channel', () => {
    expect(parseChannelKey(`dm:${B}:${A}`)?.key).toBe(`dm:${A}:${B}`);
    expect(directKey(B, A)).toBe(directKey(A, B));
    expect(parseChannelKey(`dm:${A}:${A}`)).toBeNull();
    expect(parseChannelKey(`dm:${A}:not-a-uuid`)).toBeNull();
  });

  it('parses admin threads with their owner', () => {
    const parsed = parseChannelKey(`admin:${B.toUpperCase()}`);
    expect(parsed?.key).toBe(`admin:${B}`);
    expect(parsed?.participantIds).toEqual([B]);
  });
});

describe('ChatAccessService', () => {
  const access = new ChatAccessService(null as unknown as DataSource);

  it('lets guests read General only and never write', () => {
    expect(access.canRead(null, channel('general'))).toBe(true);
    expect(access.canRead(null, channel('duel'))).toBe(false);
    expect(access.canRead(null, channel('captains'))).toBe(false);
    expect(access.canWrite(null, channel('general'))).toBe(false);
  });

  it('opens Captains to active captains and admins only', () => {
    expect(access.canRead(viewer(), channel('captains'))).toBe(false);
    expect(
      access.canRead(viewer({ isCaptain: true }), channel('captains')),
    ).toBe(true);
    expect(access.canRead(viewer({ isAdmin: true }), channel('captains'))).toBe(
      true,
    );
  });

  it('keeps DMs between their two players', () => {
    expect(access.canRead(viewer(), channel(`dm:${A}:${B}`))).toBe(true);
    expect(
      access.canRead(viewer({ playerId: C }), channel(`dm:${A}:${B}`)),
    ).toBe(false);
    expect(
      access.canRead(
        viewer({ playerId: C, isAdmin: true }),
        channel(`dm:${A}:${B}`),
      ),
    ).toBe(false);
  });

  it('shows an admin thread to its owner and to every admin', () => {
    expect(access.canRead(viewer(), channel(`admin:${A}`))).toBe(true);
    expect(access.canRead(viewer(), channel(`admin:${B}`))).toBe(false);
    expect(
      access.canRead(viewer({ isAdmin: true }), channel(`admin:${B}`)),
    ).toBe(true);
  });

  it('makes read-only players read-only except in their own admin thread', () => {
    const muted = viewer({ readOnly: true });
    expect(access.canRead(muted, channel('general'))).toBe(true);
    expect(access.canWrite(muted, channel('general'))).toBe(false);
    expect(access.canWrite(muted, channel(`dm:${A}:${B}`))).toBe(false);
    expect(access.canWrite(muted, channel(`admin:${A}`))).toBe(true);
  });

  it('summarises access for the client', () => {
    expect(access.snapshot(null)).toEqual({
      playerId: null,
      isAdmin: false,
      canCaptains: false,
      canDuel: false,
      readOnly: true,
    });
    expect(access.snapshot(viewer({ isCaptain: true })).canCaptains).toBe(true);
  });
});
