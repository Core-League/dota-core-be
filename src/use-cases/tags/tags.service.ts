import { Injectable, NotFoundException } from '@nestjs/common';
import { toTagView } from '../../db/mappers/tag.mapper';
import { PlayerRepository } from '../../repos/player.repository';
import { TagRepository } from '../../repos/tag.repository';
import type { TagView } from '../../types/entities/tags/tag';

/**
 * Admin moderation tags on players — e.g. marking a player after suspicious
 * behavior was noticed. Tags come from the fixed catalog (`tag` table); the
 * service validates both sides of the m2m before touching the join table.
 */
@Injectable()
export class TagsService {
  constructor(
    private readonly tagRepo: TagRepository,
    private readonly playerRepo: PlayerRepository,
  ) {}

  async listTags(): Promise<TagView[]> {
    const tags = await this.tagRepo.findAll();
    return tags.map(toTagView);
  }

  async getPlayerTags(playerId: string): Promise<TagView[]> {
    await this.ensurePlayerExists(playerId);
    const tags = await this.tagRepo.findByPlayerId(playerId);
    return tags.map(toTagView);
  }

  async assignTag(playerId: string, tagId: string): Promise<TagView[]> {
    await this.ensurePlayerExists(playerId);
    await this.ensureTagExists(tagId);
    await this.tagRepo.assign(playerId, tagId);
    const tags = await this.tagRepo.findByPlayerId(playerId);
    return tags.map(toTagView);
  }

  async unassignTag(playerId: string, tagId: string): Promise<void> {
    await this.ensurePlayerExists(playerId);
    await this.ensureTagExists(tagId);
    await this.tagRepo.unassign(playerId, tagId);
  }

  private async ensurePlayerExists(playerId: string): Promise<void> {
    const [player] = await this.playerRepo.findByIds([playerId]);
    if (!player) throw new NotFoundException(`Player ${playerId} not found`);
  }

  private async ensureTagExists(tagId: string): Promise<void> {
    const tag = await this.tagRepo.findById(tagId);
    if (!tag) throw new NotFoundException(`Tag ${tagId} not found`);
  }
}
