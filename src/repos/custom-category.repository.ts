import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  toCustomCategory,
  toCustomCategoryWithAttachment,
} from '../db/mappers/custom-category.mapper';
import { CustomCategoryModel } from '../db/models/custom-category.model';
import type {
  CustomCategory,
  CustomCategoryWithAttachment,
} from '../types/entities/finance/custom-category';
import type { ICustomCategoryRepository } from '../types/interfaced/repos/custom-category.repository.interface';

/** Persistence for reusable categories. */
@Injectable()
export class CustomCategoryRepository implements ICustomCategoryRepository {
  constructor(
    @InjectRepository(CustomCategoryModel)
    private readonly repo: Repository<CustomCategoryModel>,
  ) { }

  async findAll(): Promise<CustomCategory[]> {
    const models = await this.repo.find();
    return models.map(toCustomCategory);
  }

  async findAllWithAttachment(): Promise<CustomCategoryWithAttachment[]> {
    const models = await this.repo.find({ relations: { iconAsset: true } });
    return models.map(toCustomCategoryWithAttachment);
  }

  async findById(id: string): Promise<CustomCategory | null> {
    const model = await this.repo.findOne({ where: { id } });
    return model ? toCustomCategory(model) : null;
  }

  async create(
    data: Omit<CustomCategory, 'id'>,
  ): Promise<CustomCategoryWithAttachment> {
    const saved = await this.repo.save(
      this.repo.create({
        label: data.label,
        iconAssetId: data.iconAssetId,
        sign: data.sign,
        matchers: data.matchers,
      }),
    );
    return this.withAttachment(saved.id);
  }

  async update(
    id: string,
    patch: Partial<Omit<CustomCategory, 'id'>>,
  ): Promise<CustomCategoryWithAttachment> {
    await this.repo.update({ id }, patch);
    return this.withAttachment(id);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  private async withAttachment(
    id: string,
  ): Promise<CustomCategoryWithAttachment> {
    const model = await this.repo.findOneOrFail({
      where: { id },
      relations: { iconAsset: true },
    });
    return toCustomCategoryWithAttachment(model);
  }
}
