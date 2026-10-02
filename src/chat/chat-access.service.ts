import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Player } from '../players/player.entity';
import {
  CHAT_READ_ONLY_ROLE_NAMES,
  ChatChannelKind,
  type ChatChannelRef,
} from './chat.constants';

/** What the chat needs to know about the caller. `null` viewer = logged-out guest. */
export interface ChatViewer {
  playerId: string;
  isAdmin: boolean;
  /** Captain of an active (non-disbanded) team. */
  isCaptain: boolean;
  /** Can read but not write public channels and DMs. */
  readOnly: boolean;
}

/** Channel access of a viewer, as pushed in `chat:access`. */
export interface ChatAccessSnapshot {
  playerId: string | null;
  isAdmin: boolean;
  canCaptains: boolean;
  canDuel: boolean;
  readOnly: boolean;
}

/**
 * Single source of truth for who may read / write which channel. Every REST
 * read and socket command goes through here — channel keys from the client
 * are never trusted.
 */
@Injectable()
export class ChatAccessService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resolveViewer(playerId: string): Promise<ChatViewer | null> {
    const player = await this.dataSource.getRepository(Player).findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    if (!player) return null;
    const roles = player.roles ?? [];
    const captainRows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM "team" WHERE "captainId" = $1 AND "disbandedAt" IS NULL LIMIT 1`,
      [playerId],
    );
    return {
      playerId,
      isAdmin: roles.some((r) => r.isAdminRole),
      isCaptain: captainRows.length > 0,
      readOnly: roles.some((r) => CHAT_READ_ONLY_ROLE_NAMES.includes(r.name)),
    };
  }

  snapshot(viewer: ChatViewer | null): ChatAccessSnapshot {
    return {
      playerId: viewer?.playerId ?? null,
      isAdmin: viewer?.isAdmin ?? false,
      canCaptains: !!viewer && (viewer.isAdmin || viewer.isCaptain),
      canDuel: !!viewer,
      readOnly: !viewer || viewer.readOnly,
    };
  }

  canRead(viewer: ChatViewer | null, channel: ChatChannelRef): boolean {
    switch (channel.kind) {
      case ChatChannelKind.GENERAL:
        return true;
      case ChatChannelKind.DUEL:
        return !!viewer;
      case ChatChannelKind.CAPTAINS:
        return !!viewer && (viewer.isAdmin || viewer.isCaptain);
      case ChatChannelKind.ADMIN:
        return (
          !!viewer &&
          (viewer.isAdmin || viewer.playerId === channel.participantIds[0])
        );
      case ChatChannelKind.DM:
        return !!viewer && channel.participantIds.includes(viewer.playerId);
    }
  }

  /** Read-only players keep their admin thread: that is where they appeal. */
  canWrite(viewer: ChatViewer | null, channel: ChatChannelRef): boolean {
    if (!viewer || !this.canRead(viewer, channel)) return false;
    if (!viewer.readOnly) return true;
    return (
      channel.kind === ChatChannelKind.ADMIN &&
      channel.participantIds[0] === viewer.playerId
    );
  }
}
