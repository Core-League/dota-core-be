import { toAsset, toAssetView } from './asset.mapper';
import type {
  CustomCategory,
  CustomCategoryView,
  CustomCategoryWithAttachment,
} from '../../types/entities/finance/custom-category';
import { CustomCategoryModel } from '../models/custom-category.model';

/** TypeORM `CustomCategoryModel` ↔ domain `CustomCategory`. */
export function toCustomCategory(model: CustomCategoryModel): CustomCategory {
  return {
    id: model.id,
    label: model.label,
    iconAssetId: model.iconAssetId,
  };
}

/** `CustomCategoryModel` with `iconAsset` relation loaded → `CustomCategoryWithAttachment`. */
export function toCustomCategoryWithAttachment(
  model: CustomCategoryModel,
): CustomCategoryWithAttachment {
  return {
    ...toCustomCategory(model),
    iconAsset: model.iconAsset ? toAsset(model.iconAsset) : null,
  };
}

export function toCustomCategoryView(
  category: CustomCategoryWithAttachment,
  baseUrl: string,
): CustomCategoryView {
  return {
    id: category.id,
    label: category.label,
    icon: category.iconAsset ? toAssetView(category.iconAsset, baseUrl) : null,
  };
}
