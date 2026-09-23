/**
 * Maximum number of teams an auto-started or restarted playoff bracket holds
 * when the tournament runs a qualification stage: the field is cut to the top
 * N by qualification standings.
 *
 * Tournaments without qualification have no standings to cut by, so the cap
 * does not apply to them — every registered team is seated (registration is
 * bounded only by the optional `tournamentSlots`).
 */
export const PLAYOFF_TEAM_LIMIT = 8;
