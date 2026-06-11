import { z } from 'zod';
import { VerificationSlotStatus } from '../../enums/verification/VerificationSlotStatus';

/** Domain representation of a verification calendar slot. */
export const VerificationSlotSchema = z.object({
  id: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  status: z.enum(VerificationSlotStatus),
});

export type VerificationSlot = z.infer<typeof VerificationSlotSchema>;

/** Wire shape — timestamps serialized as ISO strings. */
export const VerificationSlotViewSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(VerificationSlotStatus),
});

export type VerificationSlotView = z.infer<typeof VerificationSlotViewSchema>;
