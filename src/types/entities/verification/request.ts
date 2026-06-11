import { z } from 'zod';
import { VerificationRequestStatus } from '../../enums/verification/VerificationRequestStatus';
import { VerificationType } from '../../enums/verification/VerificationType';
import { VerificationSlotViewSchema } from './slot';

/** Real (v1-owned) player loaded for a verification request, timestamps as Date. */
export const VerificationPlayerSchema = z.object({
  id: z.string(),
  steamId: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  discordName: z.string().nullable(),
  discordUsername: z.string().nullable(),
  rating: z.number(),
  positions: z.array(z.number()).nullable(),
  verifiedAt: z.date().nullable(),
});

export type VerificationPlayer = z.infer<typeof VerificationPlayerSchema>;

export const VerificationRequestPlayerSchema = z.object({
  id: z.string(),
  resultMmr: z.number().nullable(),
  player: VerificationPlayerSchema,
});

export type VerificationRequestPlayer = z.infer<
  typeof VerificationRequestPlayerSchema
>;

/** Domain representation of a verification request (timestamps as Date). */
export const VerificationRequestSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  slotId: z.string(),
  type: z.enum(VerificationType),
  status: z.enum(VerificationRequestStatus),
  createdByPlayerId: z.string(),
  createdAt: z.date(),
  players: z.array(VerificationRequestPlayerSchema),
});

export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;

/** Wire shape of the embedded player — `verifiedAt` as an ISO string. */
export const VerificationPlayerViewSchema = VerificationPlayerSchema.extend({
  verifiedAt: z.string().nullable(),
});

export type VerificationPlayerView = z.infer<
  typeof VerificationPlayerViewSchema
>;

export const VerificationRequestPlayerViewSchema = z.object({
  id: z.string(),
  resultMmr: z.number().nullable(),
  player: VerificationPlayerViewSchema,
});

/** Wire shape — adds resolved team name + slot, timestamps as ISO strings. */
export const VerificationRequestViewSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  teamName: z.string().nullable(),
  type: z.enum(VerificationType),
  status: z.enum(VerificationRequestStatus),
  createdByPlayerId: z.string(),
  createdAt: z.string(),
  slot: VerificationSlotViewSchema.nullable(),
  players: z.array(VerificationRequestPlayerViewSchema),
});

export type VerificationRequestView = z.infer<
  typeof VerificationRequestViewSchema
>;
