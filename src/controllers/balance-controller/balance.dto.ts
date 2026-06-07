import { createZodDto } from 'nestjs-zod';
import { BalanceSchema } from '../../types/entities/finance/balance';

/* ── Response DTOs ─────────────────────────────────────────────────────────── */

export class BalanceDto extends createZodDto(BalanceSchema) {}
