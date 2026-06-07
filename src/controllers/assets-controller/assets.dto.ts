import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AssetViewSchema } from '../../types/entities/finance/asset';
import { StorageType } from '../../types/enums/finance/StorageType';

/** Register a managed asset. `storageType` defaults to LOCAL. */
export const CreateAssetSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  storageType: z.enum(StorageType).default(StorageType.Local),
});

export class CreateAssetDto extends createZodDto(CreateAssetSchema) {}

/* ── Response DTOs ─────────────────────────────────────────────────────────── */

export class AssetViewDto extends createZodDto(AssetViewSchema) {}
