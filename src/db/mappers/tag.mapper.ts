import type { Tag, TagView } from '../../types/entities/tags/tag';
import { TagModel } from '../models/tag.model';

/** TypeORM `TagModel` → domain `Tag`. */
export function toTag(model: TagModel): Tag {
  return {
    id: model.id,
    name: model.name,
    title: model.title,
  };
}

export function toTagView(tag: Tag): TagView {
  return {
    id: tag.id,
    name: tag.name,
    title: tag.title,
  };
}
