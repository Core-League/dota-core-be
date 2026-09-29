/**
 * Host-bot smoke test — proves one Steam account can do the whole GC cycle
 * without the database or the API:
 *
 *   1. log into Steam (Steam Guard must be OFF on the account),
 *   2. launch Dota 2 and get a Game Coordinator session ("GC ready"),
 *   3. create an unlisted 1v1 Mid practice lobby, read its lobby id back
 *      from the shared-object cache, optionally invite players,
 *   4. leave the lobby and log off.
 *
 * Usage (never put the password on the command line of a shared shell history):
 *   HOSTBOT_SMOKE_ACCOUNT=<login> HOSTBOT_SMOKE_PASSWORD=<password> npm run bot:smoke
 * Optional:
 *   HOSTBOT_SMOKE_INVITE=7656…,7656…   SteamID64s to invite (the lobby then stays
 *                                      open for HOSTBOT_SMOKE_HOLD_SECONDS, default 60)
 *   HOSTBOT_SMOKE_REGION=3             Valve server region (default 3 = EU West)
 *
 * If step 2 never prints "GC ready", the account has not finished Dota's
 * onboarding — log into the Dota 2 client once with it and retry.
 */
import { DotaGcClient } from '../src/dota-bot/dota-gc.client';
import type { GcLobby } from '../src/dota-bot/dota-gc.protocol';

const accountName = process.env.HOSTBOT_SMOKE_ACCOUNT?.trim();
const password = process.env.HOSTBOT_SMOKE_PASSWORD;
const invite = (process.env.HOSTBOT_SMOKE_INVITE ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const region = Number(process.env.HOSTBOT_SMOKE_REGION ?? 3);
const holdSeconds = Number(process.env.HOSTBOT_SMOKE_HOLD_SECONDS ?? 60);

if (!accountName || !password) {
  console.error('Set HOSTBOT_SMOKE_ACCOUNT and HOSTBOT_SMOKE_PASSWORD');
  process.exit(2);
}
// Narrowed copies: TypeScript does not carry the guard above into closures.
const ACCOUNT: string = accountName;
const PASSWORD: string = password;

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (msg: string) => console.log(`${stamp()} | ${msg}`);

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${what}: timeout after ${ms / 1000}s`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

const once = <T = void>(gc: DotaGcClient, event: string) =>
  new Promise<T>((resolve) => gc.once(event, (v: T) => resolve(v)));

async function main(): Promise<void> {
  const gc = new DotaGcClient({
    accountName: ACCOUNT,
    password: PASSWORD,
    label: ACCOUNT,
  });
  gc.on('fatal', (err: Error) => {
    log(`FATAL: ${err.message}`);
    process.exit(1);
  });

  log('1/4 Steam login…');
  gc.logOn();
  await withTimeout(once(gc, 'ready'), 90_000, 'GC ready');
  log(
    `2/4 GC ready ✅  bot steamId64=${gc.steamId64} accountId=${gc.accountId}`,
  );

  if (gc.lobby) {
    log(`stale lobby ${gc.lobby.lobby_id} in cache — leaving it first`);
    gc.leaveLobby();
    await new Promise((r) => setTimeout(r, 2000));
  }

  log(`3/4 creating unlisted 1v1 Mid lobby (region ${region})…`);
  const lobbyPromise = once<GcLobby>(gc, 'lobbyNew');
  gc.createPracticeLobby({
    gameName: 'Core League smoke test',
    passKey: 'smoke',
    serverRegion: region,
  });
  const lobby = await withTimeout(lobbyPromise, 30_000, 'lobbyNew');
  log(
    `lobby created ✅ id=${lobby.lobby_id} state=${lobby.state} members=${lobby.all_members?.length ?? 0}`,
  );
  gc.setTeamSlot();

  if (invite.length) {
    for (const id of invite) {
      gc.inviteToLobby(id);
      log(`invited ${id}`);
    }
    log(
      `holding the lobby for ${holdSeconds}s — accept the invite in Dota and watch the roster below`,
    );
    const until = Date.now() + holdSeconds * 1000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 5000));
      const l = gc.lobby;
      if (!l) {
        log('lobby disappeared');
        break;
      }
      const roster = (l.all_members ?? [])
        .map((m) => `${m.id}:team${m.team}`)
        .join(' ');
      log(`state=${l.state} members=[${roster}]`);
    }
  }

  log('4/4 leaving lobby and logging off');
  gc.leaveLobby();
  await new Promise((r) => setTimeout(r, 1500));
  gc.logOff();
  log('DONE ✅ — this account can host duels');
  process.exit(0);
}

main().catch((err: unknown) => {
  log(`FAILED ❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
