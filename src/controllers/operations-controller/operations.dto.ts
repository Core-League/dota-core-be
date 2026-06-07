import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CustomCategoryViewSchema } from '../../types/entities/finance/custom-category';
import { FeedViewSchema } from '../../types/entities/finance/feed';
import { OperationGroupViewSchema } from '../../types/entities/finance/operation-group';
import { CategorySign } from '../../types/enums/finance/CategorySign';

/** Full editable body of an operation; replaces the per-field edit endpoints. */
export const UpdateOperationSchema = z.object({
  title: z.string().min(1),
  iconAssetId: z.string().uuid().nullable(),
  categoryId: z.string().uuid().nullable(),
  comment: z.string().nullable(),
  isHidden: z.boolean().default(false),
});
export class UpdateOperationDto extends createZodDto(UpdateOperationSchema) {}

export const GroupOperationsSchema = z.object({
  operationIds: z.array(z.string().uuid()).min(1),
  title: z.string().min(1),
  iconAssetId: z.string().uuid().optional(),
});
export class GroupOperationsDto extends createZodDto(GroupOperationsSchema) {}

/** Full editable body of a custom group: title, icon, and its members. */
export const UpdateOperationGroupSchema = z.object({
  title: z.string().min(1),
  iconAssetId: z.string().uuid().nullable(),
  operationIds: z.array(z.string().uuid()).min(1),
});
export class UpdateOperationGroupDto extends createZodDto(
  UpdateOperationGroupSchema,
) {}

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

/* ── Response DTOs (Swagger schema for the response bodies) ───────────────── */

export class FeedViewDto extends createZodDto(FeedViewSchema) {}

export class OperationGroupViewDto extends createZodDto(
  OperationGroupViewSchema,
) {}

export class CustomCategoryViewDto extends createZodDto(
  CustomCategoryViewSchema,
) {}

/** The `{ status: 'ok' }` acknowledgement returned by the mutating endpoints. */
export const StatusResponseSchema = z.object({ status: z.string() });
export class StatusResponseDto extends createZodDto(StatusResponseSchema) {}
