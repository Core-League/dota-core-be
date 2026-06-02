import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RenameOperationSchema = z.object({ label: z.string().min(1) });
export class RenameOperationDto extends createZodDto(RenameOperationSchema) {}

export const SetIconSchema = z.object({ iconAssetId: z.string().uuid() });
export class SetIconDto extends createZodDto(SetIconSchema) {}

export const GroupOperationsSchema = z.object({
  operationIds: z.array(z.string().uuid()).min(1),
  title: z.string().min(1),
  iconAssetId: z.string().uuid().optional(),
});
export class GroupOperationsDto extends createZodDto(GroupOperationsSchema) {}

export const CreateCategorySchema = z.object({
  label: z.string().min(1),
  iconAssetId: z.string().uuid().nullable().default(null),
});
export class CreateCategoryDto extends createZodDto(CreateCategorySchema) {}
