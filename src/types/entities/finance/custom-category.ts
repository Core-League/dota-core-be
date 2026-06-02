import { z } from 'zod';
import { AssetSchema, AssetViewSchema } from './asset';

/** A reusable template for custom operations: a relabel + icon asset. */
export const CustomCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  iconAssetId: z.string().nullable(),
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
