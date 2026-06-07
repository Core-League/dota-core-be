import type {
  Operation,
  OperationDraft,
  OperationUpsert,
} from '../../entities/finance/operation';

export interface OperationListFilter {
  from?: Date;
  to?: Date;
  /** Include operations marked `isHidden`. Defaults to false (hidden excluded). */
  showHidden?: boolean;
}

export interface IOperationRepository {
  findByTransactionIds(txIds: string[]): Promise<Operation[]>;
  saveMany(rows: OperationUpsert[]): Promise<Operation[]>;
  createManual(draft: OperationDraft): Promise<Operation>;
  findById(id: string): Promise<Operation | null>;
  findManyByIds(ids: string[]): Promise<Operation[]>;
  list(filter?: OperationListFilter): Promise<Operation[]>;
  setGroup(operationId: string, groupId: string | null): Promise<void>;
  update(
    operationId: string,
    patch: Partial<
      Pick<
        Operation,
        | 'title'
        | 'iconAssetId'
        | 'categoryId'
        | 'categoryManual'
        | 'comment'
        | 'isHidden'
      >
    >,
  ): Promise<void>;
  deleteByTransactionId(transactionId: string): Promise<void>;
}
