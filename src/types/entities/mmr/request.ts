import { z } from 'zod';
import { MmrUpdateRequestStatus } from '../../enums/mmr/MmrUpdateRequestStatus';
import { AssetSchema, AssetViewSchema } from '../finance/asset';

/** Real (v1-owned) player loaded for an MMR-update request, timestamps as Date. */
export const MmrPlayerSchema = z.object({
  id: z.string(),
  steamId: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  discordName: z.string().nullable(),
  discordUsername: z.string().nullable(),
  rating: z.number(),
  positions: z.array(z.number()).nullable(),
  verifiedAt: z.date().nullable(),
});

export type MmrPlayer = z.infer<typeof MmrPlayerSchema>;

/** Compact v1-owned `team` row attached to a request for the admin view. */
export const MmrTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
});

export type MmrTeam = z.infer<typeof MmrTeamSchema>;

/** Domain representation of an MMR-update request (timestamps as Date). */
export const MmrUpdateRequestSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  oldMmr: z.number(),
  newMmr: z.number(),
  status: z.enum(MmrUpdateRequestStatus),
  proofs: z.array(AssetSchema),
  createdAt: z.date(),
  player: MmrPlayerSchema,
});

export type MmrUpdateRequest = z.infer<typeof MmrUpdateRequestSchema>;

/** Wire shape of the embedded player — `verifiedAt` as an ISO string. */
export const MmrPlayerViewSchema = MmrPlayerSchema.extend({
  verifiedAt: z.string().nullable(),
});

export type MmrPlayerView = z.infer<typeof MmrPlayerViewSchema>;

/**
 * Wire shape of an MMR-update request **with** its proof assets (admin detail +
 * the player's own view). Each proof is an {@link AssetViewSchema} (id + url).
 * `team` is the player's resolved main-roster team.
 */
export const MmrUpdateRequestViewSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  oldMmr: z.number(),
  newMmr: z.number(),
  status: z.enum(MmrUpdateRequestStatus),
  createdAt: z.string(),
  player: MmrPlayerViewSchema,
  team: MmrTeamSchema.nullable(),
  proofs: z.array(AssetViewSchema),
});

export type MmrUpdateRequestView = z.infer<typeof MmrUpdateRequestViewSchema>;
