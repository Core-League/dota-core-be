import { z } from 'zod';

/**
 * A prize-recipient team. Read-only projection of the existing v1 `team` table
 * (`avatarRef` maps `team.logoUrl`); resolved from a prize comment of the form
 * `"Подарок [name]"`.
 */
export const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarRef: z.string().nullable(),
});

export type Team = z.infer<typeof TeamSchema>;
