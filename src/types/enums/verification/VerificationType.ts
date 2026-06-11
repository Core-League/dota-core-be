/**
 * Which flow a verification request follows. `FIRST` verifies not-yet-verified
 * players (sets `verifiedAt` + initial MMR); `MMR_UPDATE` re-checks already
 * verified players to refresh their MMR only.
 */
export enum VerificationType {
  First = 'FIRST',
  MmrUpdate = 'MMR_UPDATE',
}
