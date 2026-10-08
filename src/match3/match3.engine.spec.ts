import {
  applyMatch3Action,
  createMatch3Game,
  findMatch3Hint,
  isMatch3TimeUp,
  MATCH3_MAX_ROUND_MS,
  MATCH3_ROUND_MS,
  MATCH3_SIZE,
  replayMatch3,
  type IMatch3State,
  type TMatch3Action,
} from './match3.engine';

/** Bot playing one action every `paceMs`: the first hint, a skill now and then, skills when the board is dead. */
function playOut(
  seed: number,
  paceMs = 1500,
): { state: IMatch3State; log: TMatch3Action[] } {
  const state = createMatch3Game(seed);
  const log: TMatch3Action[] = [];
  let t = 0;
  let turn = 0;
  while (!state.over && !isMatch3TimeUp(state, t)) {
    const hint = findMatch3Hint(state.board);
    const candidates: TMatch3Action[] = hint
      ? turn % 7 === 6
        ? [
            { type: 'laguna', row: turn % MATCH3_SIZE, t },
            { type: 'swap', from: hint[0], to: hint[1], t },
          ]
        : [{ type: 'swap', from: hint[0], to: hint[1], t }]
      : [
          { type: 'refresher', t },
          { type: 'laguna', row: 0, t },
          { type: 'blink', from: [0, 0], to: [0, 1], t },
        ];
    const action = candidates.find(
      (a) => applyMatch3Action(state, a, false).ok,
    );
    if (!action) break;
    log.push(action);
    turn++;
    t += paceMs;
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
    expect(a.deadlineMs).toBe(MATCH3_ROUND_MS);
  });

  it('replays a played run to the exact same score and board', () => {
    for (const seed of [1, 42, 777, 2 ** 31 - 2]) {
      const { state, log } = playOut(seed);
      expect(state.score).toBeGreaterThan(0);
      const replay = replayMatch3(seed, log);
      expect(replay.valid).toBe(true);
      expect(replay.state.score).toBe(state.score);
      expect(replay.state.movesMade).toBe(state.movesMade);
      expect(replay.state.deadlineMs).toBe(state.deadlineMs);
      expect(boardKinds(replay.state)).toBe(boardKinds(state));
    }
  });

  it('always ends: the timer stops even an instant bot within the bonus cap', () => {
    for (const seed of [3, 1234, 99999]) {
      const { state, log } = playOut(seed, 100);
      expect(state.deadlineMs).toBeLessThanOrEqual(MATCH3_MAX_ROUND_MS);
      expect(log.length).toBeLessThanOrEqual(MATCH3_MAX_ROUND_MS / 100);
    }
  });

  it('rejects actions whose time runs backwards or past the deadline', () => {
    const state = createMatch3Game(7);
    const hint = findMatch3Hint(state.board)!;
    expect(
      applyMatch3Action(
        state,
        { type: 'swap', from: hint[0], to: hint[1], t: 5000 },
        false,
      ).ok,
    ).toBe(true);
    const next = findMatch3Hint(state.board)!;
    const swap = (t: number): TMatch3Action => ({
      type: 'swap',
      from: next[0],
      to: next[1],
      t,
    });
    expect(applyMatch3Action(state, swap(4999), false).ok).toBe(false);
    expect(applyMatch3Action(state, swap(state.deadlineMs), false).ok).toBe(
      false,
    );
    expect(applyMatch3Action(state, swap(5000.5), false).ok).toBe(false);
    expect(applyMatch3Action(state, swap(6000), false).ok).toBe(true);
  });

  it('rejects a log with an illegal or malformed action', () => {
    const { log } = playOut(99);
    const bad = [...log];
    bad.splice(1, 0, { type: 'swap', from: [0, 0], to: [5, 5], t: log[0].t });
    expect(replayMatch3(99, bad).valid).toBe(false);
    expect(replayMatch3(99, [{ type: 'laguna', row: 0, t: 0 }]).valid).toBe(
      false,
    ); // no mana yet
    expect(
      replayMatch3(99, [{ type: 'hack', t: 0 } as unknown as TMatch3Action])
        .valid,
    ).toBe(false);
    expect(replayMatch3(99, [null as unknown as TMatch3Action]).valid).toBe(
      false,
    );
    const hint = findMatch3Hint(createMatch3Game(99).board)!;
    expect(
      replayMatch3(99, [
        {
          type: 'swap',
          from: hint[0],
          to: hint[1],
        } as unknown as TMatch3Action,
      ]).valid,
    ).toBe(false); // no `t`
  });

  it('a non-matching swap is refused and leaves the state untouched', () => {
    let refused = 0;
    for (let c = 0; c < MATCH3_SIZE - 1; c++) {
      const state = createMatch3Game(5);
      const before = boardKinds(state);
      const result = applyMatch3Action(
        state,
        { type: 'swap', from: [0, c], to: [0, c + 1], t: 0 },
        false,
      );
      if (result.ok) continue;
      refused++;
      expect(boardKinds(state)).toBe(before);
      expect(state.movesMade).toBe(0);
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
      t: 1200,
    });
    expect(result.ok).toBe(true);
    expect(result.steps[0].kind).toBe('swap');
    expect(
      result.steps.some((s) => s.kind === 'clear' && s.cleared.length >= 3),
    ).toBe(true);
    expect(result.steps[result.steps.length - 1].kind).toBe('fall');
    expect(state.deadlineMs).toBe(MATCH3_ROUND_MS + result.timeEarned);
    expect(state.lastT).toBe(1200);
  });
});
