import type {
  Operation,
  OperationDraft,
} from '../../entities/finance/operation';

export interface OperationListFilter {
  from?: Date;
  to?: Date;
}

export interface IOperationRepository {
  upsertByTransactionId(draft: OperationDraft): Promise<Operation>;
  createManual(draft: OperationDraft): Promise<Operation>;
  findById(id: string): Promise<Operation | null>;
  findManyByIds(ids: string[]): Promise<Operation[]>;
  list(filter?: OperationListFilter): Promise<Operation[]>;
  setGroup(operationId: string, groupId: string | null): Promise<void>;
  setCategory(
    operationId: string,
    categoryId: string | null,
    manual: boolean,
  ): Promise<void>;
  update(
    operationId: string,
    patch: Partial<Pick<Operation, 'title' | 'iconAssetId'>>,
  ): Promise<void>;
  deleteByTransactionId(transactionId: string): Promise<void>;
}
