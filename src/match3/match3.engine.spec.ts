import {
  applyMatch3Action,
  createMatch3Game,
  findMatch3Hint,
  MATCH3_SIZE,
  MATCH3_START_MOVES,
  replayMatch3,
  type IMatch3State,
  type TMatch3Action,
} from './match3.engine';

/** Greedy bot: takes the first hint, falls back to skills when the board is dead. */
function playOut(seed: number): { state: IMatch3State; log: TMatch3Action[] } {
  const state = createMatch3Game(seed);
  const log: TMatch3Action[] = [];
  let turn = 0;
  while (!state.over && log.length < 1000) {
    const hint = findMatch3Hint(state.board);
    const candidates: TMatch3Action[] = hint
      ? turn % 7 === 6
        ? [
            { type: 'laguna', row: turn % MATCH3_SIZE },
            { type: 'swap', from: hint[0], to: hint[1] },
          ]
        : [{ type: 'swap', from: hint[0], to: hint[1] }]
      : [
          { type: 'refresher' },
          { type: 'laguna', row: 0 },
          { type: 'blink', from: [0, 0], to: [0, 1] },
        ];
    const action = candidates.find(
      (a) => applyMatch3Action(state, a, false).ok,
    );
    if (!action) break;
    log.push(action);
    turn++;
  }
  return { state, log };
}

const boardKinds = (state: IMatch3State) =>
  state.board
    .map((row) => row.map((cell) => `${cell.kind}:${cell.special}`).join(','))
    .join('|');

describe('match3 engine', () => {
  it('builds the same match-free board with a valid move from the same seed', () => {
    const a = createMatch3Game(12345);
    const b = createMatch3Game(12345);
    expect(boardKinds(a)).toBe(boardKinds(b));
    expect(boardKinds(a)).not.toBe(boardKinds(createMatch3Game(54321)));
    expect(findMatch3Hint(a.board)).not.toBeNull();
    expect(a.movesLeft).toBe(MATCH3_START_MOVES);
  });

  it('replays a played run to the exact same score and board', () => {
    for (const seed of [1, 42, 777, 2 ** 31 - 2]) {
      const { state, log } = playOut(seed);
      expect(state.over).toBe(true);
      expect(state.score).toBeGreaterThan(0);
      const replay = replayMatch3(seed, log);
      expect(replay.valid).toBe(true);
      expect(replay.state.score).toBe(state.score);
      expect(replay.state.movesMade).toBe(state.movesMade);
      expect(boardKinds(replay.state)).toBe(boardKinds(state));
    }
  });

  it('rejects a log with an illegal or malformed action', () => {
    const { log } = playOut(99);
    const bad = [...log];
    bad.splice(1, 0, { type: 'swap', from: [0, 0], to: [5, 5] });
    expect(replayMatch3(99, bad).valid).toBe(false);
    expect(replayMatch3(99, [{ type: 'laguna', row: 0 }]).valid).toBe(false); // no mana yet
    expect(
      replayMatch3(99, [{ type: 'hack' } as unknown as TMatch3Action]).valid,
    ).toBe(false);
    expect(replayMatch3(99, [null as unknown as TMatch3Action]).valid).toBe(
      false,
    );
    expect(
      replayMatch3(99, [
        {
          type: 'swap',
          from: [0, 0.5],
          to: [0, 1],
        } as unknown as TMatch3Action,
      ]).valid,
    ).toBe(false);
  });

  it('a non-matching swap is refused and leaves the state untouched', () => {
    let refused = 0;
    for (let c = 0; c < MATCH3_SIZE - 1; c++) {
      const state = createMatch3Game(5);
      const before = boardKinds(state);
      const result = applyMatch3Action(
        state,
        { type: 'swap', from: [0, c], to: [0, c + 1] },
        false,
      );
      if (result.ok) continue;
      refused++;
      expect(boardKinds(state)).toBe(before);
      expect(state.movesLeft).toBe(MATCH3_START_MOVES);
      expect(state.score).toBe(0);
    }
    expect(refused).toBeGreaterThan(0);
  });

  it('records animation steps on the client side', () => {
    const state = createMatch3Game(2024);
    const hint = findMatch3Hint(state.board)!;
    const result = applyMatch3Action(state, {
      type: 'swap',
      from: hint[0],
      to: hint[1],
    });
    expect(result.ok).toBe(true);
    expect(result.steps[0].kind).toBe('swap');
    expect(
      result.steps.some((s) => s.kind === 'clear' && s.cleared.length >= 3),
    ).toBe(true);
    expect(result.steps[result.steps.length - 1].kind).toBe('fall');
    expect(state.movesLeft).toBe(MATCH3_START_MOVES - 1 + result.movesEarned);
  });
});
