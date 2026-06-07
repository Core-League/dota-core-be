/**
 * Why an {@link OperationGroup} exists: `PRIZE` groups are built automatically
 * from a shared normalized comment; `SPONSOR` groups are built automatically
 * from sponsor matching; `CUSTOM` groups are assembled manually.
 */
export enum OperationGroupKind {
  Prize = 'PRIZE',
  Sponsor = 'SPONSOR',
  Custom = 'CUSTOM',
}
