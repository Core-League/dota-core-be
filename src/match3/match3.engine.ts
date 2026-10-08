/**
 * Match-3 mini-game engine (Dota heroes instead of gems).
 *
 * MIRROR of the frontend's `src/features/match3/match3-engine.utils.ts` — the
 * logic must stay identical (only formatting differs). The client plays a run
 * from a server-issued seed and sends the action log; `replayMatch3` replays it
 * here so the stored score is computed by the server, never trusted from the
 * client. Pure and deterministic: own PRNG, integer math only. Change the rules
 * in both copies at once.
 *
 * Mechanics (Ukrainian comments are kept in sync with the frontend copy):
 * - 4 в ряд → «лінія» (очищає колонку чи рядок, перпендикулярно до збігу);
 * - L / T → «бомба» (3×3);
 * - 5 в ряд → «Aegis» (обмін з героєм прибирає всіх героїв цього типу);
 * - обмін двох спецфішок → комбо (хрест, 3 рядки + 3 колонки, 5×5, перетворення всіх героїв типу);
 * - каскади: кожна наступна хвиля множить очки (×2, ×3…);
 * - час (як у Bejeweled Blitz): раунд 90 с, великі збіги й довгі каскади додають секунди, але
 *   не більше ніж до MATCH3_MAX_ROUND_MS — гра завжди скінчиться. Кожна дія несе `t` (мс від старту);
 *   рушій відкидає дії поза дедлайном чи з часом, що йде назад; бекенд звіряє `t` з реальним часом;
 * - навички за ману (мана — від кожної прибраної фішки): Blink, Laguna Blade, Refresher Orb;
 * - кінець гри: час вийшов або на полі немає жодного ходу, а мани не вистачає на навичку.
 */

export const MATCH3_SIZE = 8;
export const MATCH3_KINDS = 6;
/** Тривалість раунду без бонусів. */
export const MATCH3_ROUND_MS = 90_000;
/** Стеля дедлайну з усіма бонусами. */
export const MATCH3_MAX_ROUND_MS = 180_000;
export const MATCH3_MANA_MAX = 100;
/** Верхня межа журналу дій — бекенд відхиляє довші забіги. */
export const MATCH3_MAX_ACTIONS = 1500;
export const MATCH3_TILE_POINTS = 10;

export type TMatch3Skill = 'blink' | 'laguna' | 'refresher';

export const MATCH3_SKILL_COST: Record<TMatch3Skill, number> = {
  blink: 25,
  laguna: 40,
  refresher: 30,
};

const MIN_SKILL_COST = Math.min(...Object.values(MATCH3_SKILL_COST));
/** Запобіжник від нескінченного каскаду (на практиці недосяжний). */
const MAX_CHAIN = 60;
const SHUFFLE_ATTEMPTS = 100;

export type TMatch3Special = 'none' | 'row' | 'col' | 'bomb' | 'aegis';

export interface IMatch3Cell {
  /** Стабільний id фішки — ключ для анімацій на клієнті. */
  id: number;
  /** Тип героя 0…MATCH3_KINDS-1; у Aegis — -1 (збігів не утворює). */
  kind: number;
  special: TMatch3Special;
}

/** `board[row][col]`. */
export type TMatch3Board = IMatch3Cell[][];
export type TMatch3Pos = [number, number];

/** `t` — мілісекунди від старту раунду (ціле, не спадає від дії до дії). */
export type TMatch3Action =
  | { type: 'swap'; from: TMatch3Pos; to: TMatch3Pos; t: number }
  | { type: 'blink'; from: TMatch3Pos; to: TMatch3Pos; t: number }
  | { type: 'laguna'; row: number; t: number }
  | { type: 'refresher'; t: number };

export interface IMatch3State {
  board: TMatch3Board;
  /** Стан PRNG (int32). */
  rng: number;
  nextId: number;
  score: number;
  /** Кінець раунду, мс від старту (росте з бонусами). */
  deadlineMs: number;
  /** `t` останньої прийнятої дії. */
  lastT: number;
  mana: number;
  /** Скільки звичайних ходів зроблено. */
  movesMade: number;
  /** Найдовший каскад за гру. */
  bestChain: number;
  over: boolean;
}

export type TMatch3StepKind = 'swap' | 'clear' | 'fall' | 'shuffle';

/** Кадр анімації: знімок поля після фази й що саме сталося. */
export interface IMatch3Step {
  kind: TMatch3StepKind;
  board: TMatch3Board;
  /** id фішок, що зникають у цій фазі (`clear`). */
  cleared: number[];
  /** id щойно створених спецфішок (`clear`). */
  created: number[];
  /** id нових фішок → на скільки рядків вони падають згори (`fall`). */
  drops: Record<number, number>;
  gained: number;
  chain: number;
}

export interface IMatch3Result {
  ok: boolean;
  steps: IMatch3Step[];
  gained: number;
  /** Скільки мс додано до дедлайну (після стелі). */
  timeEarned: number;
  chain: number;
}

const SPECIAL_BONUS: Record<TMatch3Special, number> = {
  none: 0,
  row: 30,
  col: 30,
  bomb: 50,
  aegis: 100,
};
const SPECIAL_TIME: Record<TMatch3Special, number> = {
  none: 0,
  row: 1000,
  col: 1000,
  bomb: 2000,
  aegis: 3000,
};
/** На якій хвилі каскаду гравець отримує бонусний час. */
const CHAIN_TIME_AT = 3;
const CHAIN_TIME_MS = 2000;

interface IRun {
  cells: TMatch3Pos[];
  dir: 'h' | 'v';
}

interface IGroup {
  runs: IRun[];
  keys: Set<number>;
}

interface ICreate {
  key: number;
  special: TMatch3Special;
  kind: number;
}

/** Одна хвиля очищення. */
interface IPass {
  clear: Set<number>;
  create: ICreate[];
  bonus: number;
  timeEarned: number;
}

// ─── Утиліти ───────────────────────────────────────────────────────────────

const keyOf = (r: number, c: number): number => r * MATCH3_SIZE + c;
const rowOf = (key: number): number => Math.floor(key / MATCH3_SIZE);
const colOf = (key: number): number => key % MATCH3_SIZE;

const inBounds = (r: number, c: number): boolean =>
  Number.isInteger(r) &&
  Number.isInteger(c) &&
  r >= 0 &&
  r < MATCH3_SIZE &&
  c >= 0 &&
  c < MATCH3_SIZE;

function isPos(pos: unknown): pos is TMatch3Pos {
  if (!Array.isArray(pos) || pos.length !== 2) return false;
  const [r, c] = pos as unknown[];
  return typeof r === 'number' && typeof c === 'number' && inBounds(r, c);
}

const areAdjacent = (a: TMatch3Pos, b: TMatch3Pos): boolean =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

const isLine = (special: TMatch3Special): boolean =>
  special === 'row' || special === 'col';

export function cloneMatch3Board(board: TMatch3Board): TMatch3Board {
  return board.map((row) => row.map((cell) => ({ ...cell })));
}

/** mulberry32 — детермінований на будь-якому JS-рушії (Math.imul, зсуви int32). */
function nextRandom(state: IMatch3State): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randomInt(state: IMatch3State, n: number): number {
  return Math.floor(nextRandom(state) * n);
}

function newCell(state: IMatch3State, kind: number): IMatch3Cell {
  return { id: state.nextId++, kind, special: 'none' };
}

// ─── Пошук збігів ──────────────────────────────────────────────────────────

/** Кінець (не включно) ряду однакових героїв від (r, c) у напрямку (dr, dc). */
function runEnd(
  board: TMatch3Board,
  r: number,
  c: number,
  dr: number,
  dc: number,
): number {
  const kind = board[r][c].kind;
  let i = 1;
  while (
    r + dr * i < MATCH3_SIZE &&
    c + dc * i < MATCH3_SIZE &&
    board[r + dr * i][c + dc * i].kind === kind
  )
    i++;
  return (dr ? r : c) + i;
}

function collectRuns(board: TMatch3Board): IRun[] {
  const runs: IRun[] = [];
  for (let r = 0; r < MATCH3_SIZE; r++) {
    let c = 0;
    while (c < MATCH3_SIZE) {
      const kind = board[r][c].kind;
      let end = c + 1;
      if (kind >= 0) end = runEnd(board, r, c, 0, 1);
      if (kind >= 0 && end - c >= 3) {
        const cells: TMatch3Pos[] = [];
        for (let i = c; i < end; i++) cells.push([r, i]);
        runs.push({ cells, dir: 'h' });
      }
      c = end;
    }
  }
  for (let c = 0; c < MATCH3_SIZE; c++) {
    let r = 0;
    while (r < MATCH3_SIZE) {
      const kind = board[r][c].kind;
      let end = r + 1;
      if (kind >= 0) end = runEnd(board, r, c, 1, 0);
      if (kind >= 0 && end - r >= 3) {
        const cells: TMatch3Pos[] = [];
        for (let i = r; i < end; i++) cells.push([i, c]);
        runs.push({ cells, dir: 'v' });
      }
      r = end;
    }
  }
  return runs;
}

/** Ряди, що мають спільні клітинки, зливаються в одну групу (так з'являються L / T / +). */
function findGroups(board: TMatch3Board): IGroup[] {
  const runs = collectRuns(board);
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const ownerOfKey = new Map<number, number>();
  runs.forEach((run, i) => {
    for (const [r, c] of run.cells) {
      const key = keyOf(r, c);
      const owner = ownerOfKey.get(key);
      if (owner === undefined) ownerOfKey.set(key, i);
      else parent[find(i)] = find(owner);
    }
  });

  const byRoot = new Map<number, IGroup>();
  runs.forEach((run, i) => {
    const root = find(i);
    let group = byRoot.get(root);
    if (!group) {
      group = { runs: [], keys: new Set() };
      byRoot.set(root, group);
    }
    group.runs.push(run);
    for (const [r, c] of run.cells) group.keys.add(keyOf(r, c));
  });
  return [...byRoot.values()];
}

function specialForGroup(group: IGroup): TMatch3Special {
  const longest = Math.max(...group.runs.map((run) => run.cells.length));
  if (longest >= 5) return 'aegis';
  const hasH = group.runs.some((run) => run.dir === 'h');
  const hasV = group.runs.some((run) => run.dir === 'v');
  if (hasH && hasV) return 'bomb';
  // Лінія перпендикулярна до збігу: горизонтальні 4 → чистить колонку
  if (longest === 4) return group.runs[0].dir === 'h' ? 'col' : 'row';
  return 'none';
}

/** Куди ставимо спецфішку: на клітинку, яку гравець пересунув; інакше — перетин L/T чи середина ряду. */
function placementFor(
  group: IGroup,
  special: TMatch3Special,
  preferred: TMatch3Pos[],
): number {
  for (const [r, c] of preferred) {
    const key = keyOf(r, c);
    if (group.keys.has(key)) return key;
  }
  if (special === 'bomb') {
    const seen = new Set<number>();
    for (const run of group.runs) {
      for (const [r, c] of run.cells) {
        const key = keyOf(r, c);
        if (seen.has(key)) return key;
        seen.add(key);
      }
    }
  }
  const longest = group.runs.reduce((best, run) =>
    run.cells.length > best.cells.length ? run : best,
  );
  const [r, c] = longest.cells[Math.floor(longest.cells.length / 2)];
  return keyOf(r, c);
}

function passFromMatches(
  board: TMatch3Board,
  preferred: TMatch3Pos[],
): IPass | null {
  const groups = findGroups(board);
  if (!groups.length) return null;

  const pass: IPass = { clear: new Set(), create: [], bonus: 0, timeEarned: 0 };
  for (const group of groups) {
    for (const key of group.keys) pass.clear.add(key);
    const special = specialForGroup(group);
    if (special === 'none') continue;
    const key = placementFor(group, special, preferred);
    // Дві групи можуть претендувати на ту саму клітинку — друга спецфішка тоді не з'являється
    if (pass.create.some((created) => created.key === key)) continue;
    const kind = special === 'aegis' ? -1 : board[rowOf(key)][colOf(key)].kind;
    pass.create.push({ key, special, kind });
    pass.bonus += SPECIAL_BONUS[special];
    pass.timeEarned += SPECIAL_TIME[special];
  }
  return pass;
}

/** Чи утворює клітинка ряд ≥ 3 по горизонталі або вертикалі. */
function makesMatchAt(board: TMatch3Board, r: number, c: number): boolean {
  const kind = board[r][c].kind;
  if (kind < 0) return false;
  let h = 1;
  for (let i = c - 1; i >= 0 && board[r][i].kind === kind; i--) h++;
  for (let i = c + 1; i < MATCH3_SIZE && board[r][i].kind === kind; i++) h++;
  if (h >= 3) return true;
  let v = 1;
  for (let i = r - 1; i >= 0 && board[i][c].kind === kind; i--) v++;
  for (let i = r + 1; i < MATCH3_SIZE && board[i][c].kind === kind; i++) v++;
  return v >= 3;
}

function swapCells(board: TMatch3Board, a: TMatch3Pos, b: TMatch3Pos): void {
  const tmp = board[a[0]][a[1]];
  board[a[0]][a[1]] = board[b[0]][b[1]];
  board[b[0]][b[1]] = tmp;
}

/** Обмін двох спецфішок або Aegis з будь-чим — комбо, хід зараховується навіть без збігу. */
function isComboSwap(
  board: TMatch3Board,
  a: TMatch3Pos,
  b: TMatch3Pos,
): boolean {
  const sa = board[a[0]][a[1]].special;
  const sb = board[b[0]][b[1]].special;
  return sa === 'aegis' || sb === 'aegis' || (sa !== 'none' && sb !== 'none');
}

function swapMakesMatch(
  board: TMatch3Board,
  a: TMatch3Pos,
  b: TMatch3Pos,
): boolean {
  swapCells(board, a, b);
  const result =
    makesMatchAt(board, a[0], a[1]) || makesMatchAt(board, b[0], b[1]);
  swapCells(board, a, b);
  return result;
}

/** Перший доступний хід (для підказки) або null, якщо поле «мертве». */
export function findMatch3Hint(
  board: TMatch3Board,
): [TMatch3Pos, TMatch3Pos] | null {
  for (let r = 0; r < MATCH3_SIZE; r++) {
    for (let c = 0; c < MATCH3_SIZE; c++) {
      const neighbours: TMatch3Pos[] = [
        [r, c + 1],
        [r + 1, c],
      ];
      for (const n of neighbours) {
        if (!inBounds(n[0], n[1])) continue;
        const from: TMatch3Pos = [r, c];
        if (isComboSwap(board, from, n) || swapMakesMatch(board, from, n))
          return [from, n];
      }
    }
  }
  return null;
}

export function hasMatch3Move(board: TMatch3Board): boolean {
  return findMatch3Hint(board) !== null;
}

// ─── Очищення, вибухи, гравітація ─────────────────────────────────────────

function mostCommonKind(board: TMatch3Board): number {
  const counts = new Array<number>(MATCH3_KINDS).fill(0);
  for (const row of board)
    for (const cell of row) if (cell.kind >= 0) counts[cell.kind]++;
  let best = 0;
  for (let k = 1; k < MATCH3_KINDS; k++) if (counts[k] > counts[best]) best = k;
  return best;
}

function area(r0: number, c0: number, radius: number): number[] {
  const keys: number[] = [];
  for (let r = r0 - radius; r <= r0 + radius; r++) {
    for (let c = c0 - radius; c <= c0 + radius; c++) {
      if (inBounds(r, c)) keys.push(keyOf(r, c));
    }
  }
  return keys;
}

function rowKeys(r: number): number[] {
  return Array.from({ length: MATCH3_SIZE }, (_, c) => keyOf(r, c));
}

function colKeys(c: number): number[] {
  return Array.from({ length: MATCH3_SIZE }, (_, r) => keyOf(r, c));
}

function kindKeys(board: TMatch3Board, kind: number): number[] {
  const keys: number[] = [];
  board.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell.kind === kind) keys.push(keyOf(r, c));
    }),
  );
  return keys;
}

/** Що зачіпає спецфішка, коли її знищує інший вибух чи збіг. */
function blastOf(board: TMatch3Board, key: number): number[] {
  const r = rowOf(key);
  const c = colOf(key);
  switch (board[r][c].special) {
    case 'row':
      return rowKeys(r);
    case 'col':
      return colKeys(c);
    case 'bomb':
      return area(r, c, 1);
    case 'aegis':
      return kindKeys(board, mostCommonKind(board));
    default:
      return [];
  }
}

function applyPass(
  state: IMatch3State,
  pass: IPass,
  chain: number,
  steps: IMatch3Step[] | null,
): IMatch3Result {
  const board = state.board;
  const protectedKeys = new Set(pass.create.map((created) => created.key));
  const clear = new Set(pass.clear);

  // Ланцюг детонацій: спецфішка в зоні очищення вибухає й може зачепити інші
  const queue: number[] = [];
  for (const key of clear)
    if (board[rowOf(key)][colOf(key)].special !== 'none') queue.push(key);
  const triggered = new Set<number>();
  while (queue.length) {
    const key = queue.shift() as number;
    if (triggered.has(key)) continue;
    triggered.add(key);
    for (const target of blastOf(board, key)) {
      if (protectedKeys.has(target) || clear.has(target)) continue;
      clear.add(target);
      if (board[rowOf(target)][colOf(target)].special !== 'none')
        queue.push(target);
    }
  }
  for (const key of protectedKeys) clear.delete(key);

  // Нові спецфішки з'являються на місці фішки, що їх утворила (той самий id — анімується як перетворення)
  const created: number[] = [];
  for (const item of pass.create) {
    const cell = board[rowOf(item.key)][colOf(item.key)];
    cell.special = item.special;
    cell.kind = item.kind;
    created.push(cell.id);
  }

  const bonusTime =
    pass.timeEarned + (chain === CHAIN_TIME_AT ? CHAIN_TIME_MS : 0);
  const deadline = Math.min(MATCH3_MAX_ROUND_MS, state.deadlineMs + bonusTime);
  const timeEarned = deadline - state.deadlineMs;
  state.deadlineMs = deadline;
  const gained = (clear.size * MATCH3_TILE_POINTS + pass.bonus) * chain;
  state.score += gained;
  state.mana = Math.min(MATCH3_MANA_MAX, state.mana + clear.size);

  const clearedIds = [...clear].map((key) => board[rowOf(key)][colOf(key)].id);
  if (steps) {
    steps.push({
      kind: 'clear',
      board: cloneMatch3Board(board),
      cleared: clearedIds,
      created,
      drops: {},
      gained,
      chain,
    });
  }

  // Гравітація + доповнення згори
  const drops: Record<number, number> = {};
  for (let c = 0; c < MATCH3_SIZE; c++) {
    const survivors: IMatch3Cell[] = [];
    for (let r = MATCH3_SIZE - 1; r >= 0; r--) {
      if (!clear.has(keyOf(r, c))) survivors.push(board[r][c]);
    }
    const missing = MATCH3_SIZE - survivors.length;
    for (let r = MATCH3_SIZE - 1, i = 0; r >= missing; r--, i++)
      board[r][c] = survivors[i];
    for (let r = 0; r < missing; r++) {
      const cell = newCell(state, randomInt(state, MATCH3_KINDS));
      board[r][c] = cell;
      drops[cell.id] = missing;
    }
  }

  if (steps) {
    steps.push({
      kind: 'fall',
      board: cloneMatch3Board(board),
      cleared: [],
      created: [],
      drops,
      gained: 0,
      chain,
    });
  }

  return { ok: true, steps: steps ?? [], gained, timeEarned, chain };
}

/** Перша хвиля (якщо задана) + каскади, доки на полі є збіги. */
function resolve(
  state: IMatch3State,
  firstPass: IPass | null,
  preferred: TMatch3Pos[],
  steps: IMatch3Step[] | null,
): IMatch3Result {
  const total: IMatch3Result = {
    ok: true,
    steps: steps ?? [],
    gained: 0,
    timeEarned: 0,
    chain: 0,
  };
  let pass = firstPass;
  while (total.chain < MAX_CHAIN) {
    if (!pass)
      pass = passFromMatches(state.board, total.chain === 0 ? preferred : []);
    if (!pass) break;
    total.chain++;
    const result = applyPass(state, pass, total.chain, steps);
    total.gained += result.gained;
    total.timeEarned += result.timeEarned;
    pass = null;
  }
  state.bestChain = Math.max(state.bestChain, total.chain);
  return total;
}

/** Комбо двох спецфішок / Aegis. Фішки вже обміняні: `a` стоїть на `at`, `b` — на сусідній клітинці. */
function comboPass(
  board: TMatch3Board,
  at: TMatch3Pos,
  other: TMatch3Pos,
): IPass {
  const a = board[at[0]][at[1]];
  const b = board[other[0]][other[1]];
  const clear = new Set<number>([
    keyOf(at[0], at[1]),
    keyOf(other[0], other[1]),
  ]);
  const add = (keys: number[]) => keys.forEach((key) => clear.add(key));
  const [r, c] = at;
  const specials = [a.special, b.special];

  if (a.special === 'aegis' && b.special === 'aegis') {
    for (let i = 0; i < MATCH3_SIZE * MATCH3_SIZE; i++) clear.add(i);
  } else if (a.special === 'aegis' || b.special === 'aegis') {
    const partner = a.special === 'aegis' ? b : a;
    const targets = kindKeys(board, partner.kind);
    // Aegis + спецфішка: усі герої цього типу стають такими ж спецфішками й вибухають
    if (partner.special !== 'none') {
      targets.forEach((key, i) => {
        const cell = board[rowOf(key)][colOf(key)];
        if (cell.special !== 'none') return;
        cell.special = isLine(partner.special)
          ? i % 2
            ? 'row'
            : 'col'
          : partner.special;
      });
    }
    add(targets);
  } else if (isLine(specials[0]) && isLine(specials[1])) {
    add(rowKeys(r));
    add(colKeys(c));
  } else if (specials.includes('bomb') && specials.some(isLine)) {
    for (let d = -1; d <= 1; d++) {
      if (inBounds(r + d, c)) add(rowKeys(r + d));
      if (inBounds(r, c + d)) add(colKeys(c + d));
    }
  } else {
    add(area(r, c, 2));
  }

  // Самі обміняні фішки вже «витратили» свій ефект на комбо
  a.special = 'none';
  b.special = 'none';
  return { clear, create: [], bonus: SPECIAL_BONUS.bomb, timeEarned: 0 };
}

// ─── Публічне API ─────────────────────────────────────────────────────────

/** Чи утворить `kind` у (r, c) ряд із трьох з клітинками ліворуч чи згори. */
function formsStartRun(
  board: TMatch3Board,
  row: IMatch3Cell[],
  r: number,
  c: number,
  kind: number,
): boolean {
  return (
    (c >= 2 && row[c - 1].kind === kind && row[c - 2].kind === kind) ||
    (r >= 2 && board[r - 1][c].kind === kind && board[r - 2][c].kind === kind)
  );
}

function fillFreshBoard(state: IMatch3State): void {
  for (let attempt = 0; attempt < SHUFFLE_ATTEMPTS; attempt++) {
    const board: TMatch3Board = [];
    for (let r = 0; r < MATCH3_SIZE; r++) {
      const row: IMatch3Cell[] = [];
      board.push(row);
      for (let c = 0; c < MATCH3_SIZE; c++) {
        let kind = randomInt(state, MATCH3_KINDS);
        while (formsStartRun(board, row, r, c, kind))
          kind = (kind + 1) % MATCH3_KINDS;
        row.push(newCell(state, kind));
      }
    }
    state.board = board;
    if (hasMatch3Move(board)) return;
  }
}

export function createMatch3Game(seed: number): IMatch3State {
  const state: IMatch3State = {
    board: [],
    rng: seed | 0,
    nextId: 1,
    score: 0,
    deadlineMs: MATCH3_ROUND_MS,
    lastT: 0,
    mana: 0,
    movesMade: 0,
    bestChain: 0,
    over: false,
  };
  fillFreshBoard(state);
  return state;
}

/** Час рушій не «бачить» — дедлайн перевіряє клієнт за годинником, а рушій лише відкидає пізні дії. */
function updateOver(state: IMatch3State): void {
  state.over = !hasMatch3Move(state.board) && state.mana < MIN_SKILL_COST;
}

/** Чи вийшов час раунду на момент `t` (мс від старту). */
export function isMatch3TimeUp(state: IMatch3State, t: number): boolean {
  return t >= state.deadlineMs;
}

/** Чи можна зараз застосувати навичку (вистачає мани, гра триває). */
export function canUseMatch3Skill(
  state: IMatch3State,
  skill: TMatch3Skill,
): boolean {
  return !state.over && state.mana >= MATCH3_SKILL_COST[skill];
}

const FAILED: IMatch3Result = {
  ok: false,
  steps: [],
  gained: 0,
  timeEarned: 0,
  chain: 0,
};

function applySwap(
  state: IMatch3State,
  from: TMatch3Pos,
  to: TMatch3Pos,
  free: boolean,
  steps: IMatch3Step[] | null,
): IMatch3Result {
  if (!isPos(from) || !isPos(to) || !areAdjacent(from, to)) return FAILED;
  const board = state.board;
  const combo = isComboSwap(board, from, to);
  if (!free && !combo && !swapMakesMatch(board, from, to)) return FAILED;

  swapCells(board, from, to);
  if (free) state.mana -= MATCH3_SKILL_COST.blink;
  else state.movesMade++;
  if (steps) {
    steps.push({
      kind: 'swap',
      board: cloneMatch3Board(board),
      cleared: [],
      created: [],
      drops: {},
      gained: 0,
      chain: 0,
    });
  }

  // Фішка, яку тягнули, тепер стоїть на `to` — там і центр комбо, і місце нової спецфішки
  const firstPass = combo ? comboPass(board, to, from) : null;
  return resolve(state, firstPass, [to, from], steps);
}

function applyLaguna(
  state: IMatch3State,
  row: number,
  steps: IMatch3Step[] | null,
): IMatch3Result {
  if (!Number.isInteger(row) || row < 0 || row >= MATCH3_SIZE) return FAILED;
  state.mana -= MATCH3_SKILL_COST.laguna;
  const pass: IPass = {
    clear: new Set(rowKeys(row)),
    create: [],
    bonus: 0,
    timeEarned: 0,
  };
  return resolve(state, pass, [], steps);
}

function applyRefresher(
  state: IMatch3State,
  steps: IMatch3Step[] | null,
): IMatch3Result {
  state.mana -= MATCH3_SKILL_COST.refresher;
  const cells = state.board.flat();
  let shuffled = false;
  for (let attempt = 0; attempt < SHUFFLE_ATTEMPTS && !shuffled; attempt++) {
    for (let i = cells.length - 1; i > 0; i--) {
      const j = randomInt(state, i + 1);
      const tmp = cells[i];
      cells[i] = cells[j];
      cells[j] = tmp;
    }
    state.board = Array.from({ length: MATCH3_SIZE }, (_, r) =>
      cells.slice(r * MATCH3_SIZE, (r + 1) * MATCH3_SIZE),
    );
    shuffled =
      findGroups(state.board).length === 0 && hasMatch3Move(state.board);
  }
  if (!shuffled) fillFreshBoard(state);
  if (steps) {
    steps.push({
      kind: 'shuffle',
      board: cloneMatch3Board(state.board),
      cleared: [],
      created: [],
      drops: {},
      gained: 0,
      chain: 0,
    });
  }
  return { ok: true, steps: steps ?? [], gained: 0, timeEarned: 0, chain: 0 };
}

/**
 * Застосовує дію до стану (мутує його). `recordSteps` — збирати кадри анімації (клієнт);
 * бекенд при перевірці забігу їх не потребує. Недопустима дія повертає `ok: false` і стан не змінює.
 */
export function applyMatch3Action(
  state: IMatch3State,
  action: TMatch3Action,
  recordSteps = true,
): IMatch3Result {
  if (state.over || !action) return FAILED;
  // Час іде лише вперед і має вкладатися в раунд
  const t = action.t;
  if (!Number.isInteger(t) || t < state.lastT || isMatch3TimeUp(state, t))
    return FAILED;
  const steps: IMatch3Step[] | null = recordSteps ? [] : null;
  let result: IMatch3Result;

  switch (action.type) {
    case 'swap':
      result = applySwap(state, action.from, action.to, false, steps);
      break;
    case 'blink':
      if (!canUseMatch3Skill(state, 'blink')) return FAILED;
      result = applySwap(state, action.from, action.to, true, steps);
      break;
    case 'laguna':
      if (!canUseMatch3Skill(state, 'laguna')) return FAILED;
      result = applyLaguna(state, action.row, steps);
      break;
    case 'refresher':
      if (!canUseMatch3Skill(state, 'refresher')) return FAILED;
      result = applyRefresher(state, steps);
      break;
    default:
      return FAILED;
  }

  if (result.ok) {
    state.lastT = t;
    updateOver(state);
  }
  return result;
}

/** Програє журнал дій від `seed`. `valid: false` — якщо хоч одна дія недопустима. */
export function replayMatch3(
  seed: number,
  actions: TMatch3Action[],
): { state: IMatch3State; valid: boolean } {
  const state = createMatch3Game(seed);
  if (actions.length > MATCH3_MAX_ACTIONS) return { state, valid: false };
  for (const action of actions) {
    if (!applyMatch3Action(state, action, false).ok)
      return { state, valid: false };
  }
  return { state, valid: true };
}
