import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const HealthResponseSchema = z.object({ status: z.literal('ok') });

export class HealthResponseDto extends createZodDto(HealthResponseSchema) {}
