/**
 * Dev seed script — wipes and re-seeds the local DB with a minimal fixture set.
 *
 * Covers:
 *   v1 tables  : player, team
 *   v2 tables  : account, sponsor, transaction
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/seed.ts
 *
 * The script is intentionally idempotent: every table is truncated before
 * inserting, so re-running always lands in the same known state.
 *
 * After seeding, call POST /bank/sync (with the seeded accountId) to
 * classify the transactions and verify the grouped feed.
 */

import * as dotenv from 'dotenv';
import { resolve } from 'node:path';
import { Client } from 'pg';

// ---------- env ----------
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env.dev'), override: false });

const client = new Client({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'dota',
  password: process.env.DB_PASS ?? '',
  database: process.env.DB_NAME ?? 'dota_dev',
});

// ---------- fixed UUIDs (stable across runs) ----------
const ID = {
  // players
  playerCaptainRadiant: '11111111-0000-0000-0000-000000000001',
  playerCaptainDire: '11111111-0000-0000-0000-000000000002',
  playerOne: '11111111-0000-0000-0000-000000000003',
  playerTwo: '11111111-0000-0000-0000-000000000004',
  playerThree: '11111111-0000-0000-0000-000000000005',
  // teams
  teamRadiant: '22222222-0000-0000-0000-000000000001',
  teamDire: '22222222-0000-0000-0000-000000000002',
  // v2
  account: '33333333-0000-0000-0000-000000000001',
  sponsor: '44444444-0000-0000-0000-000000000001',
};

// Transactions use the Bank format (string ids, no uuid).
const TX = {
  prizeRadiant: 'tx-prize-radiant-001',
  prizeDire: 'tx-prize-dire-001',
  sponsor: 'tx-sponsor-duelo-001',
  custom: 'tx-custom-rent-001',
};

async function seed() {
  await client.connect();
  console.log('Connected to', process.env.DB_NAME ?? 'dota_dev');

  try {
    await client.query('BEGIN');

    // ------------------------------------------------------------------ v1
    // Truncate in dependency order (teams reference players).
    await client.query(`
      TRUNCATE "team_main_players", "team_reserved_players",
               "team", "player"
      RESTART IDENTITY CASCADE
    `);

    // Players — only columns that are NOT NULL and have no default.
    await client.query(
      `
      INSERT INTO "player"
        ("id", "steamId", "discordId", "telegramId",
         "avatarUrl", "discordName", "discordUsername",
         "rating", "positions", "verifiedAt", "teamId")
      VALUES
        ($1,  NULL, 'discord-captain-radiant', NULL, NULL, 'Arthas',  'arthas#0001',  100, '{1}', NOW(), $6),
        ($2,  NULL, 'discord-captain-dire',    NULL, NULL, 'Xerath',  'xerath#0002',  95,  '{1}', NOW(), $7),
        ($3,  NULL, 'discord-player-1',        NULL, NULL, 'Grimoire','grimoire#0003',80,  '{2}', NOW(), $6),
        ($4,  NULL, 'discord-player-2',        NULL, NULL, 'Sunder',  'sunder#0004',  75,  '{3}', NOW(), $6),
        ($5,  NULL, 'discord-player-3',        NULL, NULL, 'Phantom', 'phantom#0005', 70,  '{4}', NOW(), $7)
    `,
      [
        ID.playerCaptainRadiant, // $1
        ID.playerCaptainDire,    // $2
        ID.playerOne,            // $3
        ID.playerTwo,            // $4
        ID.playerThree,          // $5
        ID.teamRadiant,          // $6 — Radiant players' teamId
        ID.teamDire,             // $7 — Dire players' teamId
      ],
    );

    // Teams — captainId must exist first.
    // Name must match what parsePrizeName extracts from "Подарунок <name>":
    //   "Подарунок Radiant" → last word → "Radiant"
    await client.query(
      `
      INSERT INTO "team"
        ("id", "name", "captainId", "coachId", "logoUrl",
         "dotaTeamId", "discordRoleId", "discordChannelId",
         "isVerified", "isPlayingTournament", "verifiedAt", "disbandedAt")
      VALUES
        ($1, 'Radiant', $3, NULL, NULL, NULL, NULL, NULL, true, true, NOW(), NULL),
        ($2, 'Dire',    $4, NULL, NULL, NULL, NULL, NULL, true, true, NOW(), NULL)
    `,
      [
        ID.teamRadiant,
        ID.teamDire,
        ID.playerCaptainRadiant,
        ID.playerCaptainDire,
      ],
    );

    console.log('  v1: 5 players, 2 teams');

    // ------------------------------------------------------------------ v2
    // Truncate finance tables (FK order: operations before groups/transactions).
    await client.query(`
      TRUNCATE "operation", "operation_group",
               "transaction", "account", "sponsor"
      RESTART IDENTITY CASCADE
    `);

    // Account — mirrors a Monobank account.
    await client.query(
      `
      INSERT INTO "account" ("id", "maskedPan", "balance", "currencyCode", "type")
      VALUES ($1, '{**** 0001}', 100000000, 980, 'black')
    `,
      [ID.account],
    );

    // Sponsor — matched on description substring.
    await client.query(
      `
      INSERT INTO "sponsor" ("id", "name", "logoAssetId", "kind", "matchers")
      VALUES ($1, 'Duelo GG', NULL, 'DUELO_GG', '{"DUELO GG","duelo.gg"}')
    `,
      [ID.sponsor],
    );

    // Transactions — raw Bank payloads stored verbatim.
    // Amounts in kopecks (UAH × 100).
    await client.query(
      `
      INSERT INTO "transaction"
        ("id", "accountId", "time", "amount", "description", "comment",
         "mcc", "counterIban", "counterEdrpou", "balance", "hold", "currencyCode")
      VALUES
        -- prize for Radiant
        ($1, $5, NOW() - INTERVAL '3 days',  500000, 'Зарахування', 'Подарунок Radiant',
         0, NULL, NULL, 100000000, false, 980),
        -- prize for Dire
        ($2, $5, NOW() - INTERVAL '2 days',  300000, 'Зарахування', 'Подарунок Dire',
         0, NULL, NULL, 100000000, false, 980),
        -- sponsor payment
        ($3, $5, NOW() - INTERVAL '1 day',   800000, 'DUELO GG payment', NULL,
         0, NULL, NULL, 100000000, false, 980),
        -- generic custom
        ($4, $5, NOW(),                      -15000, 'Office rent', NULL,
         6011, NULL, NULL, 100000000, false, 980)
    `,
      [TX.prizeRadiant, TX.prizeDire, TX.sponsor, TX.custom, ID.account],
    );

    console.log('  v2: 1 account, 1 sponsor, 4 transactions');

    await client.query('COMMIT');
    console.log('Seed complete.');
    console.log('');
    console.log('Next: POST /bank/sync with accountId =', ID.account);
    console.log('      then GET /bank/feed to verify grouped rows.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
