import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CategorySign } from '../../types/enums/finance/CategorySign';

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
  sign: z.enum(CategorySign).default(CategorySign.Expense),
  matchers: z.array(z.string()).default([]),
});
export class CreateCategoryDto extends createZodDto(CreateCategorySchema) {}

/** Partial edit of a category; every field optional. */
export const UpdateCategorySchema = z
  .object({
    label: z.string().min(1),
    iconAssetId: z.string().uuid().nullable(),
    sign: z.enum(CategorySign),
    matchers: z.array(z.string()),
  })
  .partial();
export class UpdateCategoryDto extends createZodDto(UpdateCategorySchema) {}

/** Assign (or clear with `null`) the single category on an operation. */
export const AssignCategorySchema = z.object({
  categoryId: z.string().uuid().nullable(),
});
export class AssignCategoryDto extends createZodDto(AssignCategorySchema) {}
