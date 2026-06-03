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

/** Persistence for custom-operation templates. */
@Injectable()
export class CustomCategoryRepository implements ICustomCategoryRepository {
  constructor(
    @InjectRepository(CustomCategoryModel)
    private readonly repo: Repository<CustomCategoryModel>,
  ) {}

  async findAll(): Promise<CustomCategory[]> {
    const models = await this.repo.find();
    return models.map(toCustomCategory);
  }

  async create(
    data: Omit<CustomCategory, 'id'>,
  ): Promise<CustomCategoryWithAttachment> {
    const saved = await this.repo.save(
      this.repo.create({
        label: data.label,
        iconAssetId: data.iconAssetId,
      }),
    );
    const model = await this.repo.findOneOrFail({
      where: { id: saved.id },
      relations: { iconAsset: true },
    });
    return toCustomCategoryWithAttachment(model);
  }
}
