import { DataSource } from 'typeorm';

/**
 * Teams eligible for the playoff picker / staging validation:
 *
 * - Any team drawn into qualification for this tournament (`teamA` / `teamB`), **even**
 *   if match rows still have no winner/replay yet and captain points are zero.
 * - Any team linked via `tournament_team` join (many-to-many registration).
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
         SELECT tt."teamId" AS team_id
         FROM tournament_team tt
         WHERE tt."tournamentId" = $1
       ) eligible`,
    [tournamentId],
  );
  return rows.map((r) => r.team_id);
}
