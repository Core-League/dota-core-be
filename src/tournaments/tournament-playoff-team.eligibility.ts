import { DataSource } from 'typeorm';

/**
 * Teams eligible for the playoff picker / staging validation:
 *
 * - Any team drawn into qualification for this tournament (`teamA` / `teamB`), **even**
 *   if every match row has no winner/replay yet and captain points stayed at zero.
 * - Any team registered on the tournament (`team.tournamentId`), so zero-point roster
 *   slots are never excluded purely for lacking `player_tournament_points` rows.
 */
export async function findEligibleQualificationTeamIds(
  dataSource: DataSource,
  tournamentId: string,
): Promise<string[]> {
  const rows: Array<{ team_id: string }> = await dataSource.query(
    `SELECT DISTINCT team_id FROM (
         SELECT qm."teamAId" AS team_id
         FROM qualification_match qm
         INNER JOIN qualification q ON q.id = qm."qualificationId"
         WHERE q."tournamentId" = $1
         UNION
         SELECT qm."teamBId" AS team_id
         FROM qualification_match qm
         INNER JOIN qualification q ON q.id = qm."qualificationId"
         WHERE q."tournamentId" = $1
         UNION
         SELECT t.id AS team_id
         FROM team t
         WHERE t."tournamentId" = $1
       ) eligible`,
    [tournamentId],
  );
  return rows.map((r) => r.team_id);
}
