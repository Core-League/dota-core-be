/**
 * Why an {@link OperationGroup} exists: `PRIZE` groups are built automatically
 * from a shared normalized comment; `CUSTOM` groups are assembled manually.
 */
export enum OperationGroupKind {
  Prize = 'PRIZE',
  Custom = 'CUSTOM',
}
