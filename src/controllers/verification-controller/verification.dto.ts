import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { VerificationRequestViewSchema } from '../../types/entities/verification/request';
import { VerificationSlotViewSchema } from '../../types/entities/verification/slot';

/** Explicit slot start times (UTC) to publish as 30-min free slots. */
const CreateSlotsSchema = z.object({
  starts: z
    .array(
      z.iso.datetime({
        error: 'each start must be an ISO 8601 UTC date-time',
      }),
    )
    .min(1),
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
