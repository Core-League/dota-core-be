import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toTag } from '../db/mappers/tag.mapper';
import { PlayerTagModel } from '../db/models/player-tag.model';
import { TagModel } from '../db/models/tag.model';
import type { Tag } from '../types/entities/tags/tag';
import type { ITagRepository } from '../types/interfaced/repos/tag.repository.interface';

/** Persistence for the v2-owned tag catalog and player↔tag assignments. */
@Injectable()
export class TagRepository implements ITagRepository {
  constructor(
    @InjectRepository(TagModel)
    private readonly tags: Repository<TagModel>,
    @InjectRepository(PlayerTagModel)
    private readonly playerTags: Repository<PlayerTagModel>,
  ) {}

  async findAll(): Promise<Tag[]> {
    const models = await this.tags.find({ order: { name: 'ASC' } });
    return models.map(toTag);
  }

  async findById(id: string): Promise<Tag | null> {
    const model = await this.tags.findOne({ where: { id } });
    return model ? toTag(model) : null;
  }

  async findByPlayerId(playerId: string): Promise<Tag[]> {
    const links = await this.playerTags.find({
      where: { playerId },
      relations: { tag: true },
    });
    return links
      .map((l) => toTag(l.tag))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async assign(playerId: string, tagId: string): Promise<void> {
    await this.playerTags
      .createQueryBuilder()
      .insert()
      .values({ playerId, tagId })
      .orIgnore()
      .execute();
  }

  async unassign(playerId: string, tagId: string): Promise<void> {
    await this.playerTags.delete({ playerId, tagId });
  }
}
