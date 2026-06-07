import type {
  CustomCategory,
  CustomCategoryWithAttachment,
} from '../../entities/finance/custom-category';

export interface ICustomCategoryRepository {
  findAll(): Promise<CustomCategory[]>;
  findAllWithAttachment(): Promise<CustomCategoryWithAttachment[]>;
  findById(id: string): Promise<CustomCategory | null>;
  create(
    data: Omit<CustomCategory, 'id'>,
  ): Promise<CustomCategoryWithAttachment>;
  update(
    id: string,
    patch: Partial<Omit<CustomCategory, 'id'>>,
  ): Promise<CustomCategoryWithAttachment>;
  delete(id: string): Promise<void>;
}
