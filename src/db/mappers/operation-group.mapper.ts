import { toAsset, toAssetView } from './asset.mapper';
import type {
  OperationGroup,
  OperationGroupView,
  OperationGroupWithAttachment,
} from '../../types/entities/finance/operation-group';
import { OperationGroupModel } from '../models/operation-group.model';

/**
 * TypeORM `OperationGroupModel` → domain `OperationGroup`. `operationIds` comes
 * from the loaded `operations` relation (empty when not joined).
 */
export function toOperationGroup(model: OperationGroupModel): OperationGroup {
  return {
    id: model.id,
    kind: model.kind,
    title: model.title,
    iconAssetId: model.iconAssetId,
    operationIds: (model.operations ?? []).map((op) => op.id),
    groupKey: model.groupKey,
  };
}

/** `OperationGroupModel` with `iconAsset` + `operations` relations loaded → `OperationGroupWithAttachment`. */
export function toOperationGroupWithAttachment(
  model: OperationGroupModel,
): OperationGroupWithAttachment {
  return {
    ...toOperationGroup(model),
    iconAsset: model.iconAsset ? toAsset(model.iconAsset) : null,
  };
}

export function toOperationGroupView(
  group: OperationGroupWithAttachment,
  baseUrl: string,
): OperationGroupView {
  return {
    id: group.id,
    kind: group.kind,
    title: group.title,
    icon: group.iconAsset ? toAssetView(group.iconAsset, baseUrl) : null,
    operationIds: group.operationIds,
    groupKey: group.groupKey,
  };
}
