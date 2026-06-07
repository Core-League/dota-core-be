import type {
  OperationGroup,
  OperationGroupWithAttachment,
} from '../../entities/finance/operation-group';

export interface IOperationGroupRepository {
  findAll(): Promise<OperationGroup[]>;
  findAllWithAttachment(): Promise<OperationGroupWithAttachment[]>;
  findById(id: string): Promise<OperationGroup | null>;
  upsertByGroupKey(
    data: Omit<OperationGroup, 'id' | 'operationIds'>,
  ): Promise<OperationGroup>;
  upsertManyByGroupKey(
    specs: Omit<OperationGroup, 'id' | 'operationIds'>[],
  ): Promise<OperationGroup[]>;
  create(
    data: Omit<OperationGroup, 'id' | 'operationIds'>,
  ): Promise<OperationGroupWithAttachment>;
  update(
    id: string,
    patch: Partial<Pick<OperationGroup, 'title' | 'iconAssetId'>>,
  ): Promise<OperationGroupWithAttachment>;
  delete(id: string): Promise<void>;
}
