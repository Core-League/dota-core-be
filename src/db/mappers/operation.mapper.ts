import type { Operation } from '../../types/entities/finance/operation';
import { OperationModel } from '../models/operation.model';

/** TypeORM `OperationModel` ↔ domain `Operation`. */
export function toOperation(model: OperationModel): Operation {
  return {
    id: model.id,
    transactionId: model.transactionId,
    type: model.type,
    amount: model.amount,
    time: model.time,
    title: model.title,
    iconAssetId: model.iconAssetId,
    groupId: model.groupId,
    comment: model.comment,
    categoryId: model.categoryId,
    categoryManual: model.categoryManual,
    raw: model.raw,
  };
}

export function toOperationModel(entity: Operation): OperationModel {
  const model = new OperationModel();
  model.id = entity.id;
  model.transactionId = entity.transactionId;
  model.type = entity.type;
  model.amount = entity.amount;
  model.time = entity.time;
  model.title = entity.title;
  model.iconAssetId = entity.iconAssetId;
  model.groupId = entity.groupId;
  model.comment = entity.comment;
  model.categoryId = entity.categoryId;
  model.categoryManual = entity.categoryManual;
  model.raw = entity.raw;
  return model;
}
