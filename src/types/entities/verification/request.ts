import { z } from 'zod';
import { VerificationRequestStatus } from '../../enums/verification/VerificationRequestStatus';
import { VerificationType } from '../../enums/verification/VerificationType';
import { VerificationSlotViewSchema } from './slot';

export const VerificationRequestPlayerSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  resultMmr: z.number().nullable(),
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
  players: z.array(VerificationRequestPlayerSchema),
});

export type VerificationRequestView = z.infer<
  typeof VerificationRequestViewSchema
>;
