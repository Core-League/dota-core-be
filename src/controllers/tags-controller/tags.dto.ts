import { createZodDto } from 'nestjs-zod';
import { TagViewSchema } from '../../types/entities/tags/tag';

/** Wire shape of a moderation tag. */
export class TagViewDto extends createZodDto(TagViewSchema) {}
