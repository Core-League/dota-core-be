import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ForecastConfigSchema,
  ForecastResultSchema,
} from '../../types/entities/finance/forecast';

/** Active forecast configuration payload. */
export class ForecastConfigDto extends createZodDto(ForecastConfigSchema) {}

/* ── Response DTOs ─────────────────────────────────────────────────────────── */

/** The active forecast config paired with its computed result. */
export const ForecastViewSchema = z.object({
  config: ForecastConfigSchema,
  result: ForecastResultSchema,
});
export class ForecastViewDto extends createZodDto(ForecastViewSchema) {}
