import type { Tag } from '../../entities/tags/tag';

export interface ITagRepository {
  findAll(): Promise<Tag[]>;
  findById(id: string): Promise<Tag | null>;
  findByPlayerId(playerId: string): Promise<Tag[]>;
  /** Idempotent — assigning an already-assigned tag is a no-op. */
  assign(playerId: string, tagId: string): Promise<void>;
  unassign(playerId: string, tagId: string): Promise<void>;
}
