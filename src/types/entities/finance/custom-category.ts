import { z } from 'zod';
import { AssetSchema, AssetViewSchema } from './asset';
import { CategorySign } from '../../enums/finance/CategorySign';

/** A reusable template for custom operations: a relabel + icon asset. */
export const CustomCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  iconAssetId: z.string().nullable(),
  sign: z.enum(CategorySign).default(CategorySign.Expense),
  /** Substrings matched against an operation's comment/description to auto-assign this category. */
  matchers: z.array(z.string()).default([]),
});

export type CustomCategory = z.infer<typeof CustomCategorySchema>;

export const CustomCategoryWithAttachmentSchema = CustomCategorySchema.extend({
  iconAsset: AssetSchema.nullable(),
});

export type CustomCategoryWithAttachment = z.infer<
  typeof CustomCategoryWithAttachmentSchema
>;

export const CustomCategoryViewSchema = CustomCategorySchema.omit({
  iconAssetId: true,
}).extend({
  icon: AssetViewSchema.nullable(),
});

export type CustomCategoryView = z.infer<typeof CustomCategoryViewSchema>;
