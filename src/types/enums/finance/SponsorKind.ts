/**
 * Which income stream a {@link Sponsor} represents. Used by the classifier to
 * map a matched sponsor onto the corresponding {@link OperationType}.
 */
export enum SponsorKind {
  Betking = 'BETKING',
  DueloGg = 'DUELO_GG',
}
