import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MmrUpdateRequestViewSchema } from '../../types/entities/mmr/request';
import { MAX_PROOFS } from './proof-upload';

/**
 * Player submission body (multipart text part). `newMmr` arrives as a string, so
 * it is coerced; the proof images come through the file interceptor, not here.
 */
const CreateMmrRequestSchema = z.object({
  newMmr: z.coerce.number().int().min(0).max(20000),
});

export class CreateMmrRequestDto extends createZodDto(CreateMmrRequestSchema) { }

/**
 * Swagger-only description of the multipart/form-data body: the `newMmr` text
 * part plus the binary proof images. Used for docs (`@ApiBody`); validation of
 * `newMmr` is handled by {@link CreateMmrRequestDto} and the files by the
 * upload interceptor.
 */
export class CreateMmrRequestFormDto {
  @ApiProperty({ type: 'integer', example: 6500 })
  newMmr!: number;

  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    maxItems: MAX_PROOFS,
  })
  proofs!: Express.Multer.File[];
}

/** Wire shape of an MMR-update request (with proof image URLs). */
export class MmrUpdateRequestViewDto extends createZodDto(
  MmrUpdateRequestViewSchema,
) { }
