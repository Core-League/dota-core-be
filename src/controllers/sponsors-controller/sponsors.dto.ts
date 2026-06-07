import { createZodDto } from 'nestjs-zod';
import {
  SponsorSchema,
  SponsorViewSchema,
} from '../../types/entities/finance/sponsor';

const SponsorInputSchema = SponsorSchema.omit({ id: true });

/** Create/update payload for a sponsor (`id` comes from the route on update). */
export class SponsorInputDto extends createZodDto(SponsorInputSchema) {}

/* ── Response DTOs ─────────────────────────────────────────────────────────── */

export class SponsorViewDto extends createZodDto(SponsorViewSchema) {}
