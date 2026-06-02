import type {
  CustomCategory,
  CustomCategoryWithAttachment,
} from '../../entities/finance/custom-category';

export interface ICustomCategoryRepository {
  findAll(): Promise<CustomCategory[]>;
  create(
    data: Omit<CustomCategory, 'id'>,
  ): Promise<CustomCategoryWithAttachment>;
}
