/**
 * Repair qualification match groups whose Dota 2 league node has no teams bound.
 *
 * Valve's `post_addnodegroup` for `node_group_type=2` (Round Robin) stopped
 * binding added teams to the group's node: the teams land in the group's team
 * list, but the node keeps `team_id_1/2 = 0`. Such a match cannot be selected
 * when creating a lobby, so captains have to play unranked lobbies and admins
 * record results by hand. `node_group_type=7` (Showmatch) still binds correctly,
 * which is what `Dota2Service.createTwoTeamFixtureNode` now creates.
 *
 * This script re-creates the already-broken groups: delete the dead group,
 * create a Showmatch group with both teams, and point the DB row at the new id.
 *
 * Run (dry-run — reports what it would do, writes nothing):
 *   NODE_ENV=production npx ts-node -r tsconfig-paths/register \
 *     scripts/repair-qualification-fixtures.ts <tournamentId>
 *
 * Add --apply to perform the repair.
 */

import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';

import '../src/config/load-env';
import { Dota2Module } from '../src/dota2/dota2.module';
import { Dota2Service } from '../src/dota2/dota2.service';

interface MatchRow {
  id: string;
  nodeGroupId: string;
  dotaMatchId: string | null;
  aDota: string | null;
  aName: string | null;
  bDota: string | null;
  bName: string | null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const tournamentId = args.find((a) => !a.startsWith('--'));

  if (!tournamentId) {
    console.error(
      'Usage: repair-qualification-fixtures.ts <tournamentId> [--apply]',
    );
    process.exit(1);
  }

  const client = new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'dota',
    password: process.env.DB_PASS ?? '',
    database: process.env.DB_NAME ?? 'dota_dev',
  });
  await client.connect();

  const app = await NestFactory.createApplicationContext(Dota2Module, {
    logger: ['error', 'warn', 'log'],
  });
  const dota2 = app.get(Dota2Service);

  try {
    if (!dota2.isLeagueApiConfigured()) {
      throw new Error(
        'DOTA_SESSION_ID / DOTA_OAUTH_TOKEN are not both set — ' +
          'cannot talk to the league admin API',
      );
    }

    const qual = await client.query<{
      id: string;
      nodeGroupId: string;
      dotaLeagueId: number;
    }>(
      `SELECT q.id, q."nodeGroupId", t."dotaLeagueId"
         FROM qualification q
         JOIN tournament t ON t.id = q."tournamentId"
        WHERE q."tournamentId" = $1`,
      [tournamentId],
    );
    if (qual.rowCount === 0) {
      throw new Error(`No qualification found for tournament ${tournamentId}`);
    }
    const {
      id: qualificationId,
      nodeGroupId: qualNodeGroupId,
      dotaLeagueId: leagueId,
    } = qual.rows[0];
    console.log(
      `\nQualification ${qualificationId} — parent NodeGroup${qualNodeGroupId} in league ${leagueId}`,
    );

    const matches = await client.query<MatchRow>(
      `SELECT m.id,
              m."nodeGroupId",
              m."dotaMatchId",
              ta."dotaTeamId" AS "aDota", ta.name AS "aName",
              tb."dotaTeamId" AS "bDota", tb.name AS "bName"
         FROM qualification_match m
         LEFT JOIN team ta ON ta.id = m."teamAId"
         LEFT JOIN team tb ON tb.id = m."teamBId"
        WHERE m."qualificationId" = $1
        ORDER BY m."nodeGroupId"`,
      [qualificationId],
    );
    console.log(`Qualification matches in DB: ${matches.rowCount}`);

    const broken = new Set(
      await dota2.findUnplayableFixtureNodeGroups(
        leagueId,
        matches.rows.map((m) => m.nodeGroupId),
      ),
    );
    console.log(`Unplayable on the league page: ${broken.size}`);
    if (broken.size === 0) {
      console.log('Nothing to repair.');
      return;
    }

    const repairable: MatchRow[] = [];
    for (const m of matches.rows) {
      if (!broken.has(m.nodeGroupId)) continue;
      if (m.dotaMatchId) {
        console.log(
          `  SKIP NodeGroup${m.nodeGroupId} — already has dotaMatchId=${m.dotaMatchId}`,
        );
        continue;
      }
      if (!m.aDota || !m.bDota) {
        console.log(
          `  SKIP NodeGroup${m.nodeGroupId} — missing dotaTeamId ` +
            `(A=${m.aDota ?? 'null'}, B=${m.bDota ?? 'null'})`,
        );
        continue;
      }
      repairable.push(m);
    }

    console.log(
      `\n${apply ? 'Repairing' : 'Would repair'} ${repairable.length} match group(s):`,
    );
    for (const m of repairable) {
      console.log(
        `  NodeGroup${m.nodeGroupId}: ${m.aName} (${m.aDota}) vs ${m.bName} (${m.bDota})`,
      );
    }

    if (!apply) {
      console.log('\nDry run — nothing written. Re-run with --apply.');
      return;
    }

    const newIds: string[] = [];
    let failed = 0;
    for (const m of repairable) {
      const { aDota, bDota } = m;
      if (!aDota || !bDota) continue; // already filtered; keeps the types honest

      try {
        /**
         * Create → repoint → delete, in that order. Deleting first would leave
         * the DB row pointing at a node group that no longer exists if the
         * create then failed.
         */
        const newNodeGroupId = await dota2.createTwoTeamFixtureNode(
          leagueId,
          qualNodeGroupId,
          aDota,
          bDota,
          `${m.aName} vs ${m.bName}`,
        );
        await client.query(
          `UPDATE qualification_match SET "nodeGroupId" = $1 WHERE id = $2`,
          [newNodeGroupId, m.id],
        );
        newIds.push(newNodeGroupId);

        try {
          await dota2.removeNodeGroup(leagueId, m.nodeGroupId);
        } catch (err) {
          console.warn(
            `  WARN could not delete the dead NodeGroup${m.nodeGroupId} ` +
              `(remove it by hand on the league page): ${(err as Error).message}`,
          );
        }

        console.log(
          `  OK  NodeGroup${m.nodeGroupId} -> NodeGroup${newNodeGroupId}`,
        );
      } catch (err) {
        failed++;
        console.error(
          `  FAIL NodeGroup${m.nodeGroupId}: ${(err as Error).message}`,
        );
      }
    }

    const stillBroken = await dota2.findUnplayableFixtureNodeGroups(
      leagueId,
      newIds,
    );
    console.log(
      `\nRecreated ${newIds.length}, failed ${failed}, ` +
        `still unplayable after repair: ${stillBroken.length}` +
        (stillBroken.length > 0 ? ` (${stillBroken.join(', ')})` : ''),
    );
  } finally {
    await app.close();
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
