import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { VerificationRequestViewSchema } from '../../types/entities/verification/request';
import { VerificationSlotViewSchema } from '../../types/entities/verification/slot';

/** Working-hours range for auto-generating a day's 30-min slots (UTC). */
const CreateSlotsSchema = z
  .object({
    from: z.iso.datetime({ error: 'from must be an ISO 8601 UTC date-time' }),
    to: z.iso.datetime({ error: 'to must be an ISO 8601 UTC date-time' }),
  })
  .refine((v) => v.from.slice(0, 10) === v.to.slice(0, 10), {
    error: 'from and to must be on the same date',
    path: ['to'],
  });

export class CreateSlotsDto extends createZodDto(CreateSlotsSchema) {}

/** Captain books a free slot to verify a set of players. */
const CreateRequestSchema = z.object({
  slotId: z.string().uuid(),
  playerIds: z.array(z.string().uuid()).min(1),
});

export class CreateRequestDto extends createZodDto(CreateRequestSchema) {}

/** Admin completion payload — one MMR result per player in the request. */
const CompleteRequestSchema = z.object({
  results: z
    .array(
      z.object({
        playerId: z.string().uuid(),
        mmr: z.number().int().min(0),
      }),
    )
    .min(1),
});

export class CompleteRequestDto extends createZodDto(CompleteRequestSchema) {}

/** Wire shape of a verification slot. */
export class VerificationSlotViewDto extends createZodDto(
  VerificationSlotViewSchema,
) {}

/** Wire shape of a verification request. */
export class VerificationRequestViewDto extends createZodDto(
  VerificationRequestViewSchema,
) {}
