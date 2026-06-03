import { createZodDto } from 'nestjs-zod';
import { ForecastConfigSchema } from '../../types/entities/finance/forecast';

/** Active forecast configuration payload. */
export class ForecastConfigDto extends createZodDto(ForecastConfigSchema) {}
