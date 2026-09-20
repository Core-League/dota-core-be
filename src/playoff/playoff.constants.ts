/**
 * Maximum number of teams an auto-started or restarted playoff bracket holds.
 *
 * Lives apart from `PlayoffService` because tournament creation also needs it:
 * a tournament without a qualification stage has no standings to rank by, so
 * its `tournamentSlots` must not exceed the bracket size (see
 * `validateQualificationConfig`).
 */
export const PLAYOFF_TEAM_LIMIT = 8;
