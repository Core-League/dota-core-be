import type {
  OperationGroup,
  OperationGroupWithAttachment,
} from '../../entities/finance/operation-group';

export interface IOperationGroupRepository {
  findAll(): Promise<OperationGroup[]>;
  findById(id: string): Promise<OperationGroup | null>;
  upsertByGroupKey(
    data: Omit<OperationGroup, 'id' | 'operationIds'>,
  ): Promise<OperationGroup>;
  create(
    data: Omit<OperationGroup, 'id' | 'operationIds'>,
  ): Promise<OperationGroupWithAttachment>;
  setAggregatedAmount(id: string, amount: number): Promise<void>;
  deleteAllPrizeGroups(): Promise<void>;
}
