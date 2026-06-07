import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/* ── Response DTOs ─────────────────────────────────────────────────────────── */

/** The `{ status: 'ok' }` acknowledgement returned by the webhook endpoints. */
export const StatusResponseSchema = z.object({ status: z.string() });
export class StatusResponseDto extends createZodDto(StatusResponseSchema) {}
