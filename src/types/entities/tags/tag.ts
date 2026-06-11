import { z } from 'zod';

/** Domain representation of a moderation tag. */
export const TagSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
});

export type Tag = z.infer<typeof TagSchema>;

/** Wire shape — identical to the domain shape (all fields are strings). */
export const TagViewSchema = TagSchema;

export type TagView = z.infer<typeof TagViewSchema>;
