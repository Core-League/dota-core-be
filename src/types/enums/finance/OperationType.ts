/**
 * The classified kind of an {@link Operation}. Drives the displayed title/icon
 * source and how the operation is grouped. Independent of sign — color comes
 * from `sign(amount)`, not from this.
 */
export enum OperationType {
  Betking = 'BETKING',
  DueloGg = 'DUELO_GG',
  Prize = 'PRIZE',
  Custom = 'CUSTOM',
}
