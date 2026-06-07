import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Manual backfill request. `accountId` defaults to `MONOBANK_ACCOUNT_ID` when
 * omitted; `from`/`to` are ISO date-time strings (`to` defaults to now).
 */
export const SyncRequestSchema = z.object({
  accountId: z.string().optional(),
  from: z.string().datetime(),
  to: z.string().datetime().optional(),
});

export class SyncRequestDto extends createZodDto(SyncRequestSchema) { }

/* ── Response DTOs ─────────────────────────────────────────────────────────── */

export const SyncResultSchema = z.object({ synced: z.number().int() });
export class SyncResultDto extends createZodDto(SyncResultSchema) { }

export const ReclassifyResultSchema = z.object({
  reclassified: z.number().int(),
});
export class ReclassifyResultDto extends createZodDto(ReclassifyResultSchema) { }
