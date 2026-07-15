# Tournament Divisions (three tiers, range-based eligibility) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-tier average-only division model with three tiers (Початковий / Любительський / Аматорський), where a team may join any division whose average-MMR range and per-player cap it satisfies.

**Architecture:** One declarative rule table in `src/tournaments/tournament-division.util.ts` becomes the single source of truth, replacing a hardcoded `6500` that is currently duplicated in four places across two repos. The single `computeTeamDivision` function splits into three: `computeTeamAvgRating` (the number), `isTeamEligibleForDivision` (the join gate), and `resolveTeamDivision` (display only). Separating eligibility from display is what makes playing up possible — today they are the same value, so permission can only be equality.

**Tech Stack:** NestJS 11 + TypeORM 0.3 (backend, Jest); Vue 3 + TypeScript + Tailwind (frontend, **no test framework**).

**Spec:** `docs/superpowers/specs/2026-07-15-tournament-divisions-design.md`

## Global Constraints

- **Rule table (exact values, copied from the spec):**
  | Key | Label (UA) | minAvg | maxAvg | maxPlayerRating |
  | --- | --- | --- | --- | --- |
  | `DIVISION_I` | `Початковий` | 0 | 3500 | 5500 |
  | `DIVISION_II` | `Любительський` | 0 | 7000 | `null` |
  | `DIVISION_III` | `Аматорський` | 7000 | `null` | `null` |
- **All bounds are inclusive.** An average of exactly 7000 satisfies both `DIVISION_II` and `DIVISION_III`. A player rated exactly 5500 passes the `DIVISION_I` cap.
- **"Аматорський" now means the HIGHEST tier.** It previously meant the lowest. Do not assume continuity of this word when reading existing code, comments, or tournament names.
- **`DIVISION_II` is the catch-all**, accepting any average ≤ 7000 regardless of player ratings. Combined with `DIVISION_III` (7000+), every non-empty roster matches at least one division.
- **No DB migration and no data migration.** The enum already holds all three values; existing tournaments keep their keys and are relabelled in place.
- **Backend user-facing strings are Ukrainian** and the frontend maps them verbatim. Any backend message added or changed here must be mirrored in `Tournament.vue` `joinFriendlyHintFromApi` in Task 10.
- **Frontend has no test framework.** Verify frontend tasks with `npm run type-check` and `npm run lint`. Do not add a test runner.
- Backend commands: `npm run test`, `npm run lint`. Frontend: `npm run type-check`, `npm run lint`.
- Backend repo: `/Users/olleyo/projects/dota-core-be`. Frontend repo: `/Users/olleyo/projects/CoreFrontend`. Tasks 1–6 are backend; Tasks 7–10 are frontend.

---

## File Structure

**Backend (`/Users/olleyo/projects/dota-core-be`)**

| File | Responsibility |
| --- | --- |
| `src/tournaments/tournament-division.util.ts` | **Rewritten.** Rule table + the three functions. The only place thresholds exist. |
| `src/tournaments/tournament-division.util.spec.ts` | **Rewritten.** Every current case asserts the old 6500 model. |
| `src/teams/teams.service.ts:132,770` | Display + Discord category call sites → `resolveTeamDivision`. |
| `src/admin/admin.service.ts:352` | Discord sync call site → `resolveTeamDivision`. |
| `src/teams/dto/team-response.dto.ts` | Gains `avgRating`. |
| `src/qualification/qualification.service.ts:235,613` | Join gate + substitute validation. |
| `src/tournaments/dto/create-tournament.dto.ts:43-49` | Un-retire `DIVISION_III`. |

**Frontend (`/Users/olleyo/projects/CoreFrontend`)**

| File | Responsibility |
| --- | --- |
| `src/components/tournaments-tags/tournament.constants.ts` | Mirrors the rule table. Labels, hints, predicate, avg helper. |
| `src/api/types/schema.d.ts` | Regenerated for `avgRating`. |
| `src/components/TeamCard.vue`, `src/views/teams/components/TeamRoster.vue`, `TeamProfileCard.vue`, `TeamAvg.vue` | Drop four divergent local averages. |
| `src/views/tournaments/components/TournamentAdminTab.vue:263` | Admin filter → eligibility. |
| `src/views/tournaments/Tournament.vue:360` | Join error map. |
| `src/views/main/Main.vue:519` | FAQ prose. |

**Task order rationale:** Task 1 adds the new functions while leaving `computeTeamDivision` in place so the build stays green. Tasks 2–4 migrate its four consumers. Task 4 deletes it once the last consumer is gone. Backend ships before the frontend regenerates its API schema in Task 8.

---

### Task 1: Rule table and the three division functions

**Files:**
- Modify: `src/tournaments/tournament-division.util.ts` (full rewrite of the body; keep `computeTeamDivision` for now)
- Test: `src/tournaments/tournament-division.util.spec.ts` (full rewrite)

**Interfaces:**
- Consumes: `TournamentDivision` from `./tournaments.model` (already has all three values).
- Produces:
  - `DivisionRule` — `{ label: string; minAvg: number; maxAvg: number | null; maxPlayerRating: number | null }`
  - `DIVISION_RULES: Record<TournamentDivision, DivisionRule>`
  - `computeTeamAvgRating(players: { rating: number }[]): number | null`
  - `isTeamEligibleForDivision(players: { rating: number }[], division: TournamentDivision): boolean`
  - `resolveTeamDivision(players: { rating: number }[]): TournamentDivision | null`
  - `computeTeamDivision` still exported (deleted in Task 4).

- [ ] **Step 1: Replace the spec file with tests for the new model**

Overwrite `src/tournaments/tournament-division.util.spec.ts` entirely:

```ts
import {
  DIVISION_RULES,
  computeTeamAvgRating,
  isTeamEligibleForDivision,
  resolveTeamDivision,
} from './tournament-division.util';
import { TournamentDivision } from './tournaments.model';

const roster = (...ratings: number[]) => ratings.map((rating) => ({ rating }));

describe('computeTeamAvgRating', () => {
  it('returns null for an empty roster', () => {
    expect(computeTeamAvgRating([])).toBeNull();
  });

  it('averages the roster without rounding', () => {
    expect(computeTeamAvgRating(roster(1000, 2000, 3000, 4000, 5000))).toBe(3000);
    expect(computeTeamAvgRating(roster(1, 2))).toBe(1.5);
  });
});

describe('DIVISION_RULES', () => {
  it('matches the agreed thresholds', () => {
    expect(DIVISION_RULES[TournamentDivision.DIVISION_I]).toEqual({
      label: 'Початковий',
      minAvg: 0,
      maxAvg: 3500,
      maxPlayerRating: 5500,
    });
    expect(DIVISION_RULES[TournamentDivision.DIVISION_II]).toEqual({
      label: 'Любительський',
      minAvg: 0,
      maxAvg: 7000,
      maxPlayerRating: null,
    });
    expect(DIVISION_RULES[TournamentDivision.DIVISION_III]).toEqual({
      label: 'Аматорський',
      minAvg: 7000,
      maxAvg: null,
      maxPlayerRating: null,
    });
  });
});

describe('isTeamEligibleForDivision', () => {
  it('rejects an empty roster for every division', () => {
    for (const division of Object.values(TournamentDivision)) {
      expect(isTeamEligibleForDivision([], division)).toBe(false);
    }
  });

  it('accepts a low roster under the cap for DIVISION_I', () => {
    expect(
      isTeamEligibleForDivision(roster(2000, 2000, 2000, 2000, 2000), TournamentDivision.DIVISION_I),
    ).toBe(true);
  });

  it('treats the 3500 average boundary as inside DIVISION_I', () => {
    expect(
      isTeamEligibleForDivision(roster(3500, 3500, 3500, 3500, 3500), TournamentDivision.DIVISION_I),
    ).toBe(true);
    expect(
      isTeamEligibleForDivision(roster(3501, 3501, 3501, 3501, 3501), TournamentDivision.DIVISION_I),
    ).toBe(false);
  });

  // The reason this whole change exists: a cheap average must not smuggle in a
  // single very strong player.
  it('rejects DIVISION_I when one player exceeds the 5500 cap, despite a low average', () => {
    const smurfy = roster(500, 500, 500, 500, 6000); // avg 1600 — well inside 0–3500
    expect(isTeamEligibleForDivision(smurfy, TournamentDivision.DIVISION_I)).toBe(false);
    expect(isTeamEligibleForDivision(smurfy, TournamentDivision.DIVISION_II)).toBe(true);
  });

  it('treats the 5500 player cap boundary as eligible', () => {
    expect(
      isTeamEligibleForDivision(roster(500, 500, 500, 500, 5500), TournamentDivision.DIVISION_I),
    ).toBe(true);
    expect(
      isTeamEligibleForDivision(roster(500, 500, 500, 500, 5501), TournamentDivision.DIVISION_I),
    ).toBe(false);
  });

  it('ignores the player cap for divisions that have none', () => {
    expect(
      isTeamEligibleForDivision(roster(1000, 1000, 1000, 1000, 9000), TournamentDivision.DIVISION_II),
    ).toBe(true);
  });

  it('allows playing up: a weak roster is eligible for both I and II, but not III', () => {
    const weak = roster(2000, 2000, 2000, 2000, 2000);
    expect(isTeamEligibleForDivision(weak, TournamentDivision.DIVISION_I)).toBe(true);
    expect(isTeamEligibleForDivision(weak, TournamentDivision.DIVISION_II)).toBe(true);
    expect(isTeamEligibleForDivision(weak, TournamentDivision.DIVISION_III)).toBe(false);
  });

  it('treats the 7000 average as eligible for BOTH II and III', () => {
    const exactly7000 = roster(7000, 7000, 7000, 7000, 7000);
    expect(isTeamEligibleForDivision(exactly7000, TournamentDivision.DIVISION_II)).toBe(true);
    expect(isTeamEligibleForDivision(exactly7000, TournamentDivision.DIVISION_III)).toBe(true);
  });

  it('puts an average above 7000 in III only', () => {
    const strong = roster(8000, 8000, 8000, 8000, 8000);
    expect(isTeamEligibleForDivision(strong, TournamentDivision.DIVISION_I)).toBe(false);
    expect(isTeamEligibleForDivision(strong, TournamentDivision.DIVISION_II)).toBe(false);
    expect(isTeamEligibleForDivision(strong, TournamentDivision.DIVISION_III)).toBe(true);
  });
});

describe('resolveTeamDivision', () => {
  it('returns null only for an empty roster', () => {
    expect(resolveTeamDivision([])).toBeNull();
  });

  it('returns the lowest matching division', () => {
    expect(resolveTeamDivision(roster(2000, 2000, 2000, 2000, 2000))).toBe(
      TournamentDivision.DIVISION_I,
    );
    expect(resolveTeamDivision(roster(5000, 5000, 5000, 5000, 5000))).toBe(
      TournamentDivision.DIVISION_II,
    );
    expect(resolveTeamDivision(roster(8000, 8000, 8000, 8000, 8000))).toBe(
      TournamentDivision.DIVISION_III,
    );
  });

  it('resolves an exactly-7000 average to II, the lower of its two matches', () => {
    expect(resolveTeamDivision(roster(7000, 7000, 7000, 7000, 7000))).toBe(
      TournamentDivision.DIVISION_II,
    );
  });

  it('demotes a capped-out roster to II even though its average fits I', () => {
    expect(resolveTeamDivision(roster(500, 500, 500, 500, 6000))).toBe(
      TournamentDivision.DIVISION_II,
    );
  });

  it('always resolves a non-empty roster', () => {
    const samples = [roster(0), roster(3500), roster(7000), roster(99999)];
    for (const sample of samples) {
      expect(resolveTeamDivision(sample)).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/olleyo/projects/dota-core-be && npx jest src/tournaments/tournament-division.util.spec.ts
```

Expected: FAIL — TypeScript cannot resolve `DIVISION_RULES`, `computeTeamAvgRating`, `isTeamEligibleForDivision`, `resolveTeamDivision` from the util module.

- [ ] **Step 3: Rewrite the util**

Overwrite `src/tournaments/tournament-division.util.ts` entirely:

```ts
import { TournamentDivision } from './tournaments.model';

export interface DivisionRule {
  /** Ukrainian display label. */
  label: string;
  /** Inclusive lower bound on the roster's average rating. */
  minAvg: number;
  /** Inclusive upper bound on the average; null means unbounded. */
  maxAvg: number | null;
  /** Inclusive per-player ceiling; null means no cap. */
  maxPlayerRating: number | null;
}

/**
 * The single source of truth for division thresholds. Bounds are inclusive on
 * both ends, so an average of exactly 7000 satisfies BOTH DIVISION_II and
 * DIVISION_III — harmless, because a team may play up and its displayed
 * division is the lowest match.
 *
 * Note "Аматорський" is the HIGHEST tier here. It used to be the lowest.
 */
export const DIVISION_RULES: Record<TournamentDivision, DivisionRule> = {
  [TournamentDivision.DIVISION_I]: {
    label: 'Початковий',
    minAvg: 0,
    maxAvg: 3500,
    maxPlayerRating: 5500,
  },
  [TournamentDivision.DIVISION_II]: {
    label: 'Любительський',
    minAvg: 0,
    maxAvg: 7000,
    maxPlayerRating: null,
  },
  [TournamentDivision.DIVISION_III]: {
    label: 'Аматорський',
    minAvg: 7000,
    maxAvg: null,
    maxPlayerRating: null,
  },
};

/** Ascending by strength. Order matters: resolveTeamDivision returns the first match. */
const DIVISIONS_BY_STRENGTH: readonly TournamentDivision[] = [
  TournamentDivision.DIVISION_I,
  TournamentDivision.DIVISION_II,
  TournamentDivision.DIVISION_III,
];

/** The roster's mean rating, unrounded. Null for an empty roster. */
export function computeTeamAvgRating(
  players: { rating: number }[],
): number | null {
  if (!players.length) return null;
  return players.reduce((sum, p) => sum + p.rating, 0) / players.length;
}

/**
 * Whether a roster may enter a tournament in `division`. This — not the team's
 * own resolved division — is the authority for joining, which is what allows a
 * team to play up into a stronger division.
 */
export function isTeamEligibleForDivision(
  players: { rating: number }[],
  division: TournamentDivision,
): boolean {
  const avg = computeTeamAvgRating(players);
  if (avg === null) return false;

  const rule = DIVISION_RULES[division];
  if (avg < rule.minAvg) return false;
  if (rule.maxAvg !== null && avg > rule.maxAvg) return false;

  // Bound to a local so TypeScript narrows it inside the closure.
  const cap = rule.maxPlayerRating;
  if (cap !== null && players.some((p) => p.rating > cap)) return false;

  return true;
}

/**
 * The LOWEST division a roster qualifies for — display and Discord category
 * only, never eligibility. Every non-empty roster matches at least one division
 * (DIVISION_II takes any average ≤ 7000; DIVISION_III takes everything from
 * 7000 up), so null means an empty roster and nothing else.
 */
export function resolveTeamDivision(
  players: { rating: number }[],
): TournamentDivision | null {
  if (!players.length) return null;
  return (
    DIVISIONS_BY_STRENGTH.find((division) =>
      isTeamEligibleForDivision(players, division),
    ) ?? null
  );
}

/**
 * @deprecated Superseded by resolveTeamDivision / isTeamEligibleForDivision.
 * Retained only until its last call sites migrate; removed in Task 4.
 */
export function computeTeamDivision(
  players: { rating: number }[],
): TournamentDivision | null {
  if (!players.length) return null;
  const avgRating =
    players.reduce((sum, p) => sum + p.rating, 0) / players.length;
  return avgRating <= 6500
    ? TournamentDivision.DIVISION_I
    : TournamentDivision.DIVISION_II;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/olleyo/projects/dota-core-be && npx jest src/tournaments/tournament-division.util.spec.ts
```

Expected: PASS, all cases green.

- [ ] **Step 5: Lint and commit**

```bash
cd /Users/olleyo/projects/dota-core-be && npm run lint
git add src/tournaments/tournament-division.util.ts src/tournaments/tournament-division.util.spec.ts
git commit -m "feat(divisions): rule table + eligibility/display split"
```

---

### Task 2: Migrate display call sites to resolveTeamDivision

**Files:**
- Modify: `src/teams/teams.service.ts:23` (import), `:132`, `:770`
- Modify: `src/admin/admin.service.ts:19` (import), `:352`

**Interfaces:**
- Consumes: `resolveTeamDivision` from Task 1.
- Produces: nothing new. Behaviour-preserving in shape; the returned division changes because the thresholds changed.

These three call sites pick a Discord category or fill a response field. They are display concerns, so they take `resolveTeamDivision`. Their existing `if (!division)` guards stay correct — `resolveTeamDivision` still returns `null`, now only for an empty roster.

- [ ] **Step 1: Update the teams service import**

In `src/teams/teams.service.ts:23`, replace:

```ts
import { computeTeamDivision } from '../tournaments/tournament-division.util';
```

with:

```ts
import { resolveTeamDivision } from '../tournaments/tournament-division.util';
```

- [ ] **Step 2: Update both teams service call sites**

At `src/teams/teams.service.ts:132` (inside `onTeamVerified`), replace:

```ts
    const division = computeTeamDivision(team.mainPlayers ?? []);
```

with:

```ts
    const division = resolveTeamDivision(team.mainPlayers ?? []);
```

At `src/teams/teams.service.ts:770` (inside `toTeamResponse`), replace:

```ts
      division: computeTeamDivision(team.mainPlayers ?? []),
```

with:

```ts
      division: resolveTeamDivision(team.mainPlayers ?? []),
```

- [ ] **Step 3: Update the admin service**

In `src/admin/admin.service.ts:19`, replace:

```ts
import { computeTeamDivision } from '../tournaments/tournament-division.util';
```

with:

```ts
import { resolveTeamDivision } from '../tournaments/tournament-division.util';
```

At `src/admin/admin.service.ts:352` (inside the `syncDiscord` loop), replace:

```ts
      const division = computeTeamDivision(team.mainPlayers ?? []);
```

with:

```ts
      const division = resolveTeamDivision(team.mainPlayers ?? []);
```

- [ ] **Step 4: Verify the build and tests**

```bash
cd /Users/olleyo/projects/dota-core-be && npm run build && npm run test
```

Expected: build succeeds; tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/olleyo/projects/dota-core-be
git add src/teams/teams.service.ts src/admin/admin.service.ts
git commit -m "refactor(divisions): display call sites use resolveTeamDivision"
```

---

### Task 3: Range-based join gate

**Files:**
- Modify: `src/qualification/qualification.service.ts:23` (import), `:235-245`

**Interfaces:**
- Consumes: `isTeamEligibleForDivision`, `DIVISION_RULES`, `computeTeamAvgRating` from Task 1.
- Produces: three user-facing Ukrainian error strings that Task 10 mirrors on the frontend:
  - `'У складі команди немає основних гравців'`
  - `` `Середній MMR команди (${avgRounded}) не підходить для дивізіону «${label}»` ``
  - `` `Гравець з MMR ${max} перевищує ліміт ${cap} для дивізіону «${label}»` ``

The old code asked "what is this team's division, and is it exactly the tournament's?" The new code asks "may this roster enter *this* tournament?" — the shift that allows playing up.

The three messages exist because they are three different user problems with three different fixes. A captain told only "ineligible" cannot tell "drop the 7k player" from "this tournament is out of your league".

- [ ] **Step 1: Update the import**

In `src/qualification/qualification.service.ts:23`, replace:

```ts
import { computeTeamDivision } from '../tournaments/tournament-division.util';
```

with:

```ts
import {
  DIVISION_RULES,
  computeTeamAvgRating,
  isTeamEligibleForDivision,
} from '../tournaments/tournament-division.util';
```

- [ ] **Step 2: Replace the division gate**

At `src/qualification/qualification.service.ts:235-245`, replace this block:

```ts
      const teamDivision = computeTeamDivision(main);
      if (!teamDivision) {
        throw new BadRequestException(
          'Рейтинг команди виходить за межі дозволених дивізіонів',
        );
      }
      if (teamDivision !== tournament.division) {
        throw new BadRequestException(
          `Дивізіон команди (${teamDivision}) не відповідає дивізіону турніру (${tournament.division})`,
        );
      }
```

with:

```ts
      // An empty roster is checked separately: it is not an MMR problem, and the
      // all-players-verified check above passes vacuously on an empty list.
      if (!main.length) {
        throw new BadRequestException('У складі команди немає основних гравців');
      }

      if (
        tournament.division &&
        !isTeamEligibleForDivision(main, tournament.division)
      ) {
        throw new BadRequestException(
          this.divisionRejectionMessage(main, tournament.division),
        );
      }
```

- [ ] **Step 3: Add the message helper**

Add this private method to `QualificationService`, directly above the existing `private validateSubstitute(` at `src/qualification/qualification.service.ts:613`:

```ts
  /**
   * Explains WHY a roster failed a division. Average-out-of-range and
   * player-over-cap are different problems with different fixes, and a captain
   * cannot act on an undifferentiated rejection.
   */
  private divisionRejectionMessage(
    main: { rating: number }[],
    division: TournamentDivision,
  ): string {
    const rule = DIVISION_RULES[division];

    // Bound to a local so TypeScript narrows it inside the closure.
    const cap = rule.maxPlayerRating;
    if (cap !== null) {
      const overCap = main
        .map((p) => p.rating)
        .filter((rating) => rating > cap);
      if (overCap.length) {
        const highest = Math.round(Math.max(...overCap));
        return `Гравець з MMR ${highest} перевищує ліміт ${cap} для дивізіону «${rule.label}»`;
      }
    }

    const avg = computeTeamAvgRating(main);
    const avgRounded = avg === null ? 0 : Math.round(avg);
    return `Середній MMR команди (${avgRounded}) не підходить для дивізіону «${rule.label}»`;
  }
```

- [ ] **Step 4: Add the TournamentDivision import if absent**

Check whether `TournamentDivision` is already imported in `src/qualification/qualification.service.ts`:

```bash
cd /Users/olleyo/projects/dota-core-be && grep -n "TournamentDivision" src/qualification/qualification.service.ts | head -3
```

If no import line appears, add:

```ts
import { TournamentDivision } from '../tournaments/tournaments.model';
```

- [ ] **Step 5: Verify the build and tests**

```bash
cd /Users/olleyo/projects/dota-core-be && npm run build && npm run test && npm run lint
```

Expected: build succeeds; tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/olleyo/projects/dota-core-be
git add src/qualification/qualification.service.ts
git commit -m "feat(divisions): range-based join gate with per-reason errors"
```

---

### Task 4: Substitute validation against the tournament's division

**Files:**
- Modify: `src/qualification/qualification.service.ts:259` (call site), `:613-643` (`validateSubstitute`)
- Modify: `src/tournaments/tournament-division.util.ts` (delete `computeTeamDivision`)

**Interfaces:**
- Consumes: `isTeamEligibleForDivision`, `DIVISION_RULES` from Task 1.
- Produces: `validateSubstitute(mainPlayers, sub, division)` — signature gains a third parameter. Error string `` `Запасний гравець ${sub.id} не підходить для дивізіону турніру` `` (mirrored in Task 10).

**Why the existing two-sided trick still works.** The current proof: replacing the lowest-rated starter maximises the post-swap average, replacing the highest-rated minimises it, so if both extremes stay in division, every intermediate does. Adding a per-player cap does not break this, because eligibility decomposes:

- **Cap** is a property of the multiset, independent of who is replaced. Given every starter already passes, the post-swap roster passes iff the substitute does.
- **Average** still varies monotonically between the two extremes.

So the check survives. It changes in two ways: it validates against **the tournament's** division rather than against the team's division being unchanged (correct under play-up — a sub may shift the team's *resolved* division while the roster still satisfies the tournament it is entering), and it adds a flat cap check.

- [ ] **Step 1: Replace validateSubstitute**

At `src/qualification/qualification.service.ts:613-643`, replace the whole method:

```ts
  private validateSubstitute(mainPlayers: Player[], sub: Player): void {
    const ratings = mainPlayers.map((p) => p.rating).sort((a, b) => a - b);
    if (ratings.length === 0) return;

    const originalDivision = computeTeamDivision(mainPlayers);

    // A sub can come in for ANY main player. Replacing the lowest-rated player
    // maximises the team's post-substitution average; replacing the highest-rated
    // one minimises it; every other position lands between those two. Division is
    // a monotonic threshold on the average, so if BOTH extremes stay in the
    // original division the substitution is safe regardless of whom it replaces.
    const divisionWithReplacementAt = (index: number) => {
      const modified = [...ratings];
      modified[index] = sub.rating;
      return computeTeamDivision(modified.map((rating) => ({ rating })));
    };

    const divisionReplacingLowest = divisionWithReplacementAt(0);
    const divisionReplacingHighest = divisionWithReplacementAt(
      ratings.length - 1,
    );

    if (
      divisionReplacingLowest !== originalDivision ||
      divisionReplacingHighest !== originalDivision
    ) {
      throw new BadRequestException(
        `Запасний гравець ${sub.id} змінює дивізіон команди — заміна не дозволена`,
      );
    }
  }
```

with:

```ts
  /**
   * A sub may come in for ANY main player, so the roster must stay eligible for
   * the tournament's division under every possible swap. Checking two extremes
   * suffices, because eligibility decomposes:
   *   - the per-player cap is independent of WHO is replaced, so it is a flat
   *     check on the sub (every starter already passes);
   *   - the average is monotonic — replacing the lowest-rated starter maximises
   *     it, replacing the highest minimises it, and every other slot lands
   *     between those two.
   * So if both extremes are eligible, all five are.
   *
   * Note this validates against the TOURNAMENT's division, not against the
   * team's division being unchanged: under play-up a sub may shift the team's
   * resolved division while the roster still satisfies the tournament it enters.
   */
  private validateSubstitute(
    mainPlayers: Player[],
    sub: Player,
    division: TournamentDivision,
  ): void {
    const ratings = mainPlayers.map((p) => p.rating).sort((a, b) => a - b);
    if (ratings.length === 0) return;

    const rule = DIVISION_RULES[division];
    if (rule.maxPlayerRating !== null && sub.rating > rule.maxPlayerRating) {
      throw new BadRequestException(
        `Запасний гравець ${sub.id} не підходить для дивізіону турніру`,
      );
    }

    const eligibleWithReplacementAt = (index: number) => {
      const modified = [...ratings];
      modified[index] = sub.rating;
      return isTeamEligibleForDivision(
        modified.map((rating) => ({ rating })),
        division,
      );
    };

    if (
      !eligibleWithReplacementAt(0) ||
      !eligibleWithReplacementAt(ratings.length - 1)
    ) {
      throw new BadRequestException(
        `Запасний гравець ${sub.id} не підходить для дивізіону турніру`,
      );
    }
  }
```

- [ ] **Step 2: Update the call site**

At `src/qualification/qualification.service.ts:259`, replace:

```ts
        this.validateSubstitute(main, sub);
```

with:

```ts
        if (tournament.division) {
          this.validateSubstitute(main, sub, tournament.division);
        }
```

- [ ] **Step 3: Delete the deprecated function**

`computeTeamDivision` now has no callers. Confirm:

```bash
cd /Users/olleyo/projects/dota-core-be && grep -rn "computeTeamDivision" src/
```

Expected: only its definition in `src/tournaments/tournament-division.util.ts`.

Delete this entire block from the end of `src/tournaments/tournament-division.util.ts`:

```ts
/**
 * @deprecated Superseded by resolveTeamDivision / isTeamEligibleForDivision.
 * Retained only until its last call sites migrate; removed in Task 4.
 */
export function computeTeamDivision(
  players: { rating: number }[],
): TournamentDivision | null {
  if (!players.length) return null;
  const avgRating =
    players.reduce((sum, p) => sum + p.rating, 0) / players.length;
  return avgRating <= 6500
    ? TournamentDivision.DIVISION_I
    : TournamentDivision.DIVISION_II;
}
```

- [ ] **Step 4: Verify nothing references it and the build is green**

```bash
cd /Users/olleyo/projects/dota-core-be && grep -rn "computeTeamDivision" src/ ; npm run build && npm run test && npm run lint
```

Expected: grep prints nothing; build succeeds; tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/olleyo/projects/dota-core-be
git add src/qualification/qualification.service.ts src/tournaments/tournament-division.util.ts
git commit -m "feat(divisions): validate subs against tournament division; drop computeTeamDivision"
```

---

### Task 5: Un-retire DIVISION_III for tournament creation

**Files:**
- Modify: `src/tournaments/dto/create-tournament.dto.ts:43-49`

**Interfaces:**
- Consumes: `TournamentDivision` (already imported in this file).
- Produces: the create/update API accepts all three divisions. Task 7 relies on this to offer `DIVISION_III` in the frontend create form.

No DB migration: `tournament_division_enum` already contains all three values (`src/migrations/1780358677674-InitialSchema.ts:17`), and the Discord category ID for `DIVISION_III` already exists (`src/discord/discord-bot.service.ts:15`).

- [ ] **Step 1: Accept all three divisions**

At `src/tournaments/dto/create-tournament.dto.ts:43-49`, replace:

```ts
  @ApiProperty({
    enum: [TournamentDivision.DIVISION_I, TournamentDivision.DIVISION_II],
    enumName: 'TournamentDivision',
    description: 'DIVISION_III is retired and cannot be set',
  })
  @IsIn([TournamentDivision.DIVISION_I, TournamentDivision.DIVISION_II])
  division: TournamentDivision;
```

with:

```ts
  @ApiProperty({
    enum: TournamentDivision,
    enumName: 'TournamentDivision',
    description:
      'DIVISION_I = Початковий (avg 0–3500, player cap 5500), DIVISION_II = Любительський (avg 0–7000), DIVISION_III = Аматорський (avg 7000+)',
  })
  @IsEnum(TournamentDivision)
  division: TournamentDivision;
```

- [ ] **Step 2: Fix the imports**

`IsIn` may now be unused in this file, and `IsEnum` may not be imported. Check:

```bash
cd /Users/olleyo/projects/dota-core-be && grep -n "IsIn\|IsEnum" src/tournaments/dto/create-tournament.dto.ts
```

Update the `class-validator` import line so that `IsEnum` is imported and `IsIn` is dropped **only if** no other `IsIn(` usage remains in the file.

- [ ] **Step 3: Verify build, tests and lint**

```bash
cd /Users/olleyo/projects/dota-core-be && npm run build && npm run test && npm run lint
```

Expected: build succeeds; tests pass; no unused-import lint errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/olleyo/projects/dota-core-be
git add src/tournaments/dto/create-tournament.dto.ts
git commit -m "feat(divisions): allow DIVISION_III on tournament create"
```

---

### Task 6: Expose the team average on the API

**Files:**
- Modify: `src/teams/dto/team-response.dto.ts` (add `avgRating` after `division`)
- Modify: `src/teams/teams.service.ts:770` (`toTeamResponse`)

**Interfaces:**
- Consumes: `computeTeamAvgRating` from Task 1; `resolveTeamDivision` (already wired in Task 2).
- Produces: `TeamResponseDto.avgRating: number | null` — the rounded mean rating of `mainPlayers`, `null` for an empty roster. Tasks 8 and 9 consume it as `Team.avgRating` in `schema.d.ts`.

**Why:** the frontend reduces this average in four places that disagree — `TeamCard.vue:180`, `TeamRoster.vue:324` and `TeamProfileCard.vue:212` average main players only, while `TeamAvg.vue:14` averages mains **plus reserves**, so one team displays two different AVG numbers today. Rounded server-side so every screen shows the same integer.

- [ ] **Step 1: Add the DTO field**

In `src/teams/dto/team-response.dto.ts`, immediately after the existing `division` property:

```ts
  @ApiPropertyOptional({ enum: TournamentDivision, nullable: true })
  division: TournamentDivision | null;
```

add:

```ts
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Rounded mean rating of mainPlayers (reserves excluded). Null for an empty roster.',
  })
  avgRating: number | null;
```

- [ ] **Step 2: Populate it**

In `src/teams/teams.service.ts`, add `computeTeamAvgRating` to the existing import from `'../tournaments/tournament-division.util'` (which already imports `resolveTeamDivision` from Task 2):

```ts
import {
  computeTeamAvgRating,
  resolveTeamDivision,
} from '../tournaments/tournament-division.util';
```

Then at `src/teams/teams.service.ts:770` in `toTeamResponse`, replace:

```ts
      division: resolveTeamDivision(team.mainPlayers ?? []),
```

with:

```ts
      division: resolveTeamDivision(team.mainPlayers ?? []),
      avgRating: roundOrNull(computeTeamAvgRating(team.mainPlayers ?? [])),
```

and add this module-level helper near the top of `src/teams/teams.service.ts`, after the import block:

```ts
const roundOrNull = (value: number | null): number | null =>
  value === null ? null : Math.round(value);
```

- [ ] **Step 3: Verify the build, tests and the emitted Swagger field**

```bash
cd /Users/olleyo/projects/dota-core-be && npm run build && npm run test && npm run lint
```

Expected: build succeeds; tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/olleyo/projects/dota-core-be
git add src/teams/dto/team-response.dto.ts src/teams/teams.service.ts
git commit -m "feat(teams): expose avgRating on team responses"
```

---

### Task 7: Frontend rule table

**Files:**
- Modify: `/Users/olleyo/projects/CoreFrontend/src/components/tournaments-tags/tournament.constants.ts:43-150`
- Modify: `/Users/olleyo/projects/CoreFrontend/src/views/admin-panel/components/drawers/CreateTournamentDrawer.vue:320-327`

**Interfaces:**
- Consumes: nothing from the backend at runtime; this mirrors `DIVISION_RULES` by hand.
- Produces (imported by Tasks 8–10):
  - `DIVISION_RULES: Record<TTournamentDivisionValue, TDivisionRule>`
  - `computeTeamAvgRating(players: { rating?: number | null }[] | null | undefined): number | null` — **rounded**, to match the API's `avgRating`.
  - `isTeamEligibleForDivision(players, division): boolean`
  - `resolveTeamDivision(players): TTournamentDivisionValue | null`
  - `resolveTeamDivisionForDisplay(rawDivision, mainPlayers)` — **signature changed**: second parameter is now the roster, not a pre-computed average.
  - `tournamentDivisionLabelMap`, `tournamentDivisionMmrHintMap`, `TOURNAMENT_DIVISION_CREATE_VALUES` (all three values).
- Removed (no consumers may remain after Task 9): `DIVISION_AVG_MMR_THRESHOLD`, `inferTournamentDivisionFromAvgRating`.

`normalizeTournamentDivision` and the two class maps are unchanged — the styling already covers all three keys (cyan / fuchsia / amber).

This task is **four targeted edits**, not a wholesale block replacement. Leave `TOURNAMENT_DIVISION_VALUES` (:35-41), `TOURNAMENT_DIVISION_VALUE_SET` (:53), `normalizeTournamentDivision` (:55-74), both class maps (:114-143) and `PROFILE_CAPTAIN_ROLE_UA` (:152) exactly as they are.

Do **not** rewrite `normalizeTournamentDivision`. Its `І`/`і`/`Ι`/`ι` escapes are deliberate: the function exists to catch Cyrillic and Greek homoglyphs of `I`, and spelling them as literal characters would make it unreadable and trivially corrupted by a careless copy-paste.

- [ ] **Step 1a: Offer all three divisions when creating a tournament**

At `src/components/tournaments-tags/tournament.constants.ts:43-51`, replace:

```ts
/**
 * Дивізіони, доступні для вибору при створенні/редагуванні турніру.
 * DIVISION_III — застарілий: не пропонуємо його для нових турнірів,
 * але лишаємо у TOURNAMENT_DIVISION_VALUES, щоб коректно відображати старі записи.
 */
export const TOURNAMENT_DIVISION_CREATE_VALUES = [
  'DIVISION_I',
  'DIVISION_II'
] as const
```

with:

```ts
/** Усі три дивізіони доступні для створення/редагування турніру. */
export const TOURNAMENT_DIVISION_CREATE_VALUES = [
  'DIVISION_I',
  'DIVISION_II',
  'DIVISION_III'
] as const
```

- [ ] **Step 1b: Replace the threshold and inference block with the rule table**

At `src/components/tournaments-tags/tournament.constants.ts:76-104`, replace everything from `/** Поріг середнього MMR між дивізіонами...` through the end of `resolveTeamDivisionForDisplay` (that is: `DIVISION_AVG_MMR_THRESHOLD`, `inferTournamentDivisionFromAvgRating` and `resolveTeamDivisionForDisplay`) with:

```ts
export interface TDivisionRule {
  label: string
  /** Нижня межа середнього рейтингу, включно. */
  minAvg: number
  /** Верхня межа середнього рейтингу, включно; null — без обмежень. */
  maxAvg: number | null
  /** Ліміт по окремому гравцю, включно; null — без ліміту. */
  maxPlayerRating: number | null
}

/**
 * Дзеркало бекенду: src/tournaments/tournament-division.util.ts (DIVISION_RULES).
 * Межі включні з обох боків, тому АВГ рівно 7000 підходить і під DIVISION_II,
 * і під DIVISION_III — це нормально, бо команда може грати вгору, а на картці
 * показуємо найнижчий збіг.
 *
 * Увага: «Аматорський» тепер НАЙВИЩИЙ дивізіон (раніше був найнижчим).
 */
export const DIVISION_RULES: Record<TTournamentDivisionValue, TDivisionRule> = {
  DIVISION_I: { label: 'Початковий', minAvg: 0, maxAvg: 3500, maxPlayerRating: 5500 },
  DIVISION_II: { label: 'Любительський', minAvg: 0, maxAvg: 7000, maxPlayerRating: null },
  DIVISION_III: { label: 'Аматорський', minAvg: 7000, maxAvg: null, maxPlayerRating: null }
}

/** За зростанням сили. Порядок важливий: resolveTeamDivision бере перший збіг. */
const DIVISIONS_BY_STRENGTH: readonly TTournamentDivisionValue[] = [
  'DIVISION_I',
  'DIVISION_II',
  'DIVISION_III'
]

type TRatedPlayer = { rating?: number | null }

/** Середній рейтинг основи, округлений — щоб збігатися з `avgRating` з API. */
export function computeTeamAvgRating (
  players: TRatedPlayer[] | null | undefined
): number | null {
  const list = players ?? []
  if (!list.length) return null
  const sum = list.reduce((acc, p) => acc + (Number(p.rating) || 0), 0)
  return Math.round(sum / list.length)
}

/**
 * Чи може склад зайти в турнір цього дивізіону. Саме це — не власний дивізіон
 * команди — вирішує допуск, і саме це дозволяє грати вгору.
 */
export function isTeamEligibleForDivision (
  players: TRatedPlayer[] | null | undefined,
  division: TTournamentDivisionValue
): boolean {
  const list = players ?? []
  const avg = computeTeamAvgRating(list)
  if (avg == null) return false

  const rule = DIVISION_RULES[division]
  if (avg < rule.minAvg) return false
  if (rule.maxAvg != null && avg > rule.maxAvg) return false

  // Локальна змінна, щоб TypeScript звузив тип усередині колбека.
  const cap = rule.maxPlayerRating
  if (cap != null && list.some((p) => (Number(p.rating) || 0) > cap)) return false

  return true
}

/** Найнижчий дивізіон, якому склад відповідає. Лише для відображення. */
export function resolveTeamDivision (
  players: TRatedPlayer[] | null | undefined
): TTournamentDivisionValue | null {
  const list = players ?? []
  if (!list.length) return null
  return DIVISIONS_BY_STRENGTH.find((d) => isTeamEligibleForDivision(list, d)) ?? null
}

/** Дивізіон для відображення: значення з API, інакше — рахуємо зі складу основи. */
export function resolveTeamDivisionForDisplay (
  rawDivision: string | null | undefined,
  mainPlayers: TRatedPlayer[] | null | undefined
): TTournamentDivisionValue | null {
  const fromApi = normalizeTournamentDivision(rawDivision)
  if (fromApi != null) return fromApi
  return resolveTeamDivision(mainPlayers)
}
```

- [ ] **Step 1c: Update the labels**

At `src/components/tournaments-tags/tournament.constants.ts:106-112`, replace:

```ts
/** Підпис дивізіону (ключі як у API турніру / команди). */
export const tournamentDivisionLabelMap: Record<TTournamentDivisionValue, string> = {
  DIVISION_I: 'Аматорський',
  DIVISION_II: 'Професійний',
  // DIVISION_III — застарілий, лишаємо підпис лише для старих турнірів.
  DIVISION_III: 'Дивізіон III'
}
```

with:

```ts
/** Підпис дивізіону (ключі як у API турніру / команди). Джерело — DIVISION_RULES. */
export const tournamentDivisionLabelMap: Record<TTournamentDivisionValue, string> = {
  DIVISION_I: DIVISION_RULES.DIVISION_I.label,
  DIVISION_II: DIVISION_RULES.DIVISION_II.label,
  DIVISION_III: DIVISION_RULES.DIVISION_III.label
}
```

- [ ] **Step 1d: Update the MMR hints**

At `src/components/tournaments-tags/tournament.constants.ts:145-150`, replace:

```ts
export const tournamentDivisionMmrHintMap: Record<TTournamentDivisionValue, string> = {
  DIVISION_I: 'Середній MMR команди: 0–6 500',
  DIVISION_II: 'Середній MMR команди: 6 500+ (без ліміту)',
  // DIVISION_III — застарілий дивізіон, лишаємо лише для відображення старих турнірів.
  DIVISION_III: 'Середній MMR команди: без обмежень'
}
```

with:

```ts
export const tournamentDivisionMmrHintMap: Record<TTournamentDivisionValue, string> = {
  DIVISION_I: 'Середній MMR команди: 0–3 500, максимум 5 500 на гравця',
  DIVISION_II: 'Середній MMR команди: 0–7 000, без ліміту на гравця',
  DIVISION_III: 'Середній MMR команди: 7 000+, без ліміту на гравця'
}
```

- [ ] **Step 1e: Drop the now-dead DIVISION_III workaround in the create/edit drawer**

`CreateTournamentDrawer.vue` offers only the active divisions and pushes `DIVISION_III` back in when editing a legacy tournament. With all three now in `TOURNAMENT_DIVISION_CREATE_VALUES` (Step 1a), that branch can never fire and its comment states the opposite of the truth.

At `src/views/admin-panel/components/drawers/CreateTournamentDrawer.vue:320-327`, replace:

```ts
// Для нових турнірів пропонуємо лише активні дивізіони (I, II). При редагуванні
// старого турніру з DIVISION_III лишаємо його в списку, щоб значення відображалось коректно.
const divisionOptions = computed<TTournamentDivisionValue[]>(() => {
  const base = [...TOURNAMENT_DIVISION_CREATE_VALUES] as TTournamentDivisionValue[]
  const current = props.tournament?.division as TTournamentDivisionValue | undefined
  if (current && !base.includes(current)) base.push(current)
  return base
})
```

with:

```ts
// Усі три дивізіони активні, тому окремий фолбек для застарілих значень більше не потрібен.
const divisionOptions = computed<TTournamentDivisionValue[]>(
  () => [...TOURNAMENT_DIVISION_CREATE_VALUES]
)
```

- [ ] **Step 2: Find every consumer of the removed exports**

```bash
cd /Users/olleyo/projects/CoreFrontend && grep -rn "DIVISION_AVG_MMR_THRESHOLD\|inferTournamentDivisionFromAvgRating\|resolveTeamDivisionForDisplay" src/
```

Expected hits (all fixed in Tasks 8–9): `TeamCard.vue`, `TeamProfileCard.vue`, `TournamentAdminTab.vue`. Note them; type-check will fail until those tasks land.

- [ ] **Step 3: Type-check (expected to fail on known call sites only)**

```bash
cd /Users/olleyo/projects/CoreFrontend && npm run type-check
```

Expected: errors ONLY in the files listed in Step 2, for the removed exports and the changed `resolveTeamDivisionForDisplay` signature. Any other error means something was dropped from the file that should have been kept — fix before continuing.

- [ ] **Step 4: Commit**

```bash
cd /Users/olleyo/projects/CoreFrontend
git add src/components/tournaments-tags/tournament.constants.ts src/views/admin-panel/components/drawers/CreateTournamentDrawer.vue
git commit -m "feat(divisions): three-tier rule table mirroring the backend"
```

---

### Task 8: Regenerate the API schema and use the server-side average

**Files:**
- Modify: `/Users/olleyo/projects/CoreFrontend/src/api/types/schema.d.ts` (regenerated)
- Modify: `src/components/TeamCard.vue:180-192`
- Modify: `src/views/teams/components/TeamRoster.vue:324-329`
- Modify: `src/views/teams/components/TeamProfileCard.vue:212-222`
- Modify: `src/views/teams/components/TeamAvg.vue:14-19`

**Interfaces:**
- Consumes: `Team.avgRating` from Task 6; `computeTeamAvgRating` and the changed `resolveTeamDivisionForDisplay(rawDivision, mainPlayers)` from Task 7.
- Produces: nothing downstream.

Each component prefers the API's `avgRating` and falls back to a local computation, so the UI stays correct against a backend that has not yet deployed Task 6.

- [ ] **Step 1: Start the backend locally**

```bash
cd /Users/olleyo/projects/dota-core-be && npm run start:dev
```

Wait for Nest to report it is listening on port 3000. Leave it running for the next step.

- [ ] **Step 2: Regenerate the schema and review the diff**

```bash
cd /Users/olleyo/projects/CoreFrontend && npm run api:local && git diff --stat src/api/types/schema.d.ts
```

`npm run api:local` regenerates the **whole** schema from `http://localhost:3000/api-json`, so it can pull in unrelated drift if the local backend is ahead of production. Inspect the diff:

```bash
cd /Users/olleyo/projects/CoreFrontend && git diff src/api/types/schema.d.ts
```

Expected: `TeamResponseDto` gains `avgRating?: number | null`, and `CreateTournamentDto.division` widens to include `DIVISION_III` (from Task 5). If the diff contains unrelated changes, discard it (`git checkout src/api/types/schema.d.ts`) and instead hand-add the single field to `TeamResponseDto` (near line 1201, after `division`):

```ts
            /** @description Rounded mean rating of mainPlayers (reserves excluded). Null for an empty roster. */
            avgRating?: number | null;
```

- [ ] **Step 3: TeamCard.vue — use the API average**

At `src/components/TeamCard.vue:180-192`, replace:

```ts
const mainAvgRating = computed(() => {
  const mains = props.team.mainPlayers ?? []
  if (!mains.length) return null
  const sum = mains.reduce((acc, p) => acc + (Number(p.rating) || 0), 0)
  return Math.round(sum / mains.length)
})

const resolvedDivisionKey = computed((): TTournamentDivisionValue | null =>
  resolveTeamDivisionForDisplay(
    'division' in props.team ? props.team.division : undefined,
    mainAvgRating.value
  )
)
```

with:

```ts
const mainAvgRating = computed(() =>
  ('avgRating' in props.team ? props.team.avgRating : null) ??
  computeTeamAvgRating(props.team.mainPlayers)
)

const resolvedDivisionKey = computed((): TTournamentDivisionValue | null =>
  resolveTeamDivisionForDisplay(
    'division' in props.team ? props.team.division : undefined,
    props.team.mainPlayers
  )
)
```

Add `computeTeamAvgRating` to the existing import from `@/components/tournaments-tags/tournament.constants`.

- [ ] **Step 4: TeamRoster.vue — use the API average**

At `src/views/teams/components/TeamRoster.vue:324-329`, replace:

```ts
const mainRosterAvgRatingRounded = computed(() => {
  const mains = props.team?.mainPlayers ?? []
  if (!mains.length) return null
  const sum = mains.reduce((acc, p) => acc + (Number(p.rating) || 0), 0)
  return Math.round(sum / mains.length)
})
```

with:

```ts
const mainRosterAvgRatingRounded = computed(() =>
  props.team?.avgRating ?? computeTeamAvgRating(props.team?.mainPlayers)
)
```

Add to the imports:

```ts
import { computeTeamAvgRating } from '@/components/tournaments-tags/tournament.constants'
```

- [ ] **Step 5: TeamProfileCard.vue — use the API average**

At `src/views/teams/components/TeamProfileCard.vue:212-222`, replace:

```ts
const mainRosterAvgRatingRounded = computed(() => {
  const mains = props.team?.mainPlayers ?? []
  if (!mains.length) return null
  const sum = mains.reduce((acc, p) => acc + (Number(p.rating) || 0), 0)
  return Math.round(sum / mains.length)
})

const teamDivisionForDisplay = computed(() =>
  props.team
    ? resolveTeamDivisionForDisplay(props.team.division, mainRosterAvgRatingRounded.value)
    : null
)
```

with:

```ts
const mainRosterAvgRatingRounded = computed(() =>
  props.team?.avgRating ?? computeTeamAvgRating(props.team?.mainPlayers)
)

const teamDivisionForDisplay = computed(() =>
  props.team
    ? resolveTeamDivisionForDisplay(props.team.division, props.team.mainPlayers)
    : null
)
```

Add `computeTeamAvgRating` to the existing import from `@/components/tournaments-tags/tournament.constants`.

- [ ] **Step 6: TeamAvg.vue — stop including reserves**

This is the divergence that makes one team show two different AVG numbers. At `src/views/teams/components/TeamAvg.vue:14-19`, replace:

```ts
const teamAvg = computed(() => {
  if (!props.team) return null
  const allPlayers = [...(props.team.mainPlayers || []), ...(props.team.reservedPlayers || [])]
  if (!allPlayers.length) return 0
  return Math.round(allPlayers.reduce((acc, curr) => acc + (curr.rating ?? 0), 0) / allPlayers.length)
})
```

with:

```ts
// Основа без запасних — так само, як рахує бекенд (`avgRating`) і як показують
// картка та профіль команди.
const teamAvg = computed(() =>
  props.team?.avgRating ?? computeTeamAvgRating(props.team?.mainPlayers)
)
```

Add to the imports:

```ts
import { computeTeamAvgRating } from '@/components/tournaments-tags/tournament.constants'
```

- [ ] **Step 7: Confirm no local average survives**

```bash
cd /Users/olleyo/projects/CoreFrontend && grep -rn "reduce((acc, p) => acc + (Number(p.rating)\|reduce((acc, curr) => acc + (curr.rating" src/
```

Expected: no output.

- [ ] **Step 8: Type-check and lint**

```bash
cd /Users/olleyo/projects/CoreFrontend && npm run type-check && npm run lint
```

Expected: `TeamCard.vue`, `TeamRoster.vue`, `TeamProfileCard.vue` and `TeamAvg.vue` are clean. `TournamentAdminTab.vue` may still error — Task 9 fixes it.

- [ ] **Step 9: Commit**

```bash
cd /Users/olleyo/projects/CoreFrontend
git add src/api/types/schema.d.ts src/components/TeamCard.vue src/views/teams/components/TeamRoster.vue src/views/teams/components/TeamProfileCard.vue src/views/teams/components/TeamAvg.vue
git commit -m "feat(teams): single server-computed AVG across every team surface"
```

---

### Task 9: Admin filter uses eligibility, not equality

**Files:**
- Modify: `/Users/olleyo/projects/CoreFrontend/src/views/tournaments/components/TournamentAdminTab.vue:261-279`

**Interfaces:**
- Consumes: `isTeamEligibleForDivision` from Task 7.
- Produces: nothing downstream.

The admin filter must agree with the backend join gate from Task 3. If it kept equality, an admin could not add a playing-up team that the public join flow accepts — the two paths would contradict each other on the same tournament.

- [ ] **Step 1: Replace the local computeDivision and the filter**

At `src/views/tournaments/components/TournamentAdminTab.vue:261-279`, replace:

```ts
// Дивізіон рахуємо лише за середнім MMR основи (без верхньої межі по гравцю),
// щоб фільтр збігався з бекендом (tournament-division.util.ts, поріг 6500).
function computeDivision (mainPlayers: { rating: number }[]): string | null {
  if (mainPlayers.length === 0) return null
  const ratings = mainPlayers.map((p) => p.rating)
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length
  return inferTournamentDivisionFromAvgRating(avg)
}

const eligibleTeams = computed(() => {
  const tournamentDivision = props.tournament?.division ?? null
  return allTeams.value.filter((t) => {
    if (!t.isVerified) return false
    if (!tournamentDivision) return true
    const main = t.mainPlayers ?? []
    if (main.length === 0) return false
    return computeDivision(main) === tournamentDivision
  })
})
```

with:

```ts
// Допуск — за діапазоном дивізіону + лімітом на гравця, дзеркалить бекенд
// (tournament-division.util.ts, isTeamEligibleForDivision). Команда може грати
// вгору, тому це НЕ порівняння з власним дивізіоном команди.
const eligibleTeams = computed(() => {
  const tournamentDivision = normalizeTournamentDivision(props.tournament?.division)
  return allTeams.value.filter((t) => {
    if (!t.isVerified) return false
    if (!tournamentDivision) return true
    const main = t.mainPlayers ?? []
    if (main.length === 0) return false
    return isTeamEligibleForDivision(main, tournamentDivision)
  })
})
```

- [ ] **Step 2: Fix the imports**

In the same file, find the import from `@/components/tournaments-tags/tournament.constants`, drop `inferTournamentDivisionFromAvgRating`, and add `isTeamEligibleForDivision` and `normalizeTournamentDivision`:

```bash
cd /Users/olleyo/projects/CoreFrontend && grep -n "tournament.constants" src/views/tournaments/components/TournamentAdminTab.vue
```

- [ ] **Step 3: Confirm the removed exports have no consumers left**

```bash
cd /Users/olleyo/projects/CoreFrontend && grep -rn "DIVISION_AVG_MMR_THRESHOLD\|inferTournamentDivisionFromAvgRating" src/
```

Expected: no output.

- [ ] **Step 4: Type-check and lint — now fully clean**

```bash
cd /Users/olleyo/projects/CoreFrontend && npm run type-check && npm run lint
```

Expected: no errors anywhere.

- [ ] **Step 5: Commit**

```bash
cd /Users/olleyo/projects/CoreFrontend
git add src/views/tournaments/components/TournamentAdminTab.vue
git commit -m "fix(admin): filter teams by division eligibility, allowing play-up"
```

---

### Task 10: Join error messages and FAQ copy

**Files:**
- Modify: `/Users/olleyo/projects/CoreFrontend/src/views/tournaments/Tournament.vue:360-386`
- Modify: `/Users/olleyo/projects/CoreFrontend/src/views/main/Main.vue:519`

**Interfaces:**
- Consumes: the exact backend strings from Tasks 3 and 4.
- Produces: nothing downstream.

`joinFriendlyHintFromApi` maps backend Ukrainian strings to friendlier copy and falls through to the raw string (`return msg`) on a miss, so stale keys degrade silently rather than loudly. The keys removed here no longer exist in the backend after Tasks 3–4.

- [ ] **Step 1: Update the error map**

At `src/views/tournaments/Tournament.vue:360-386`, replace the `hints` object entry:

```ts
    'Рейтинг команди виходить за межі дозволених дивізіонів': 'Середній MMR команди не відповідає дивізіону турніру.',
```

with:

```ts
    'У складі команди немає основних гравців': 'У складі команди немає основних гравців.',
```

Then replace the two prefix-match blocks:

```ts
  if (msg.startsWith('Дивізіон команди') && msg.includes('не відповідає')) { return 'Дивізіон вашої команди не збігається з дивізіоном турніру.' }

  if (msg.includes('Запасний гравець') && msg.includes('не верифікований')) { return 'Є не верифікований запасний гравець — перевірте заявку.' }
```

with:

```ts
  // Бекенд розрізняє дві причини відмови — АВГ поза діапазоном і гравець понад
  // ліміт. Це різні проблеми з різними рішеннями, тому не зливаємо їх в одну.
  if (msg.startsWith('Середній MMR команди') && msg.includes('не підходить')) { return msg }

  if (msg.startsWith('Гравець з MMR') && msg.includes('перевищує ліміт')) { return msg }

  if (msg.includes('Запасний гравець') && msg.includes('не верифікований')) { return 'Є не верифікований запасний гравець — перевірте заявку.' }

  if (msg.includes('Запасний гравець') && msg.includes('не підходить для дивізіону')) { return 'Запасний гравець не підходить для дивізіону турніру — перевірте його MMR.' }
```

The two new backend messages already name the specific number and division, so they are passed through verbatim rather than replaced with vaguer copy.

- [ ] **Step 2: Rewrite the FAQ answer**

At `src/views/main/Main.vue:519`, replace:

```ts
    a: 'У Core League два дивізіони за рівнем гри. Аматорський (Дивізіон I) — середній рейтинг команди 0–6500 MMR; Професійний (Дивізіон II) — 6500+ MMR (без верхньої межі). Верхньої межі по окремому гравцю немає — рахується лише середній рейтинг команди (AVG усіх п’яти гравців складу).'
```

with:

```ts
    a: 'У Core League три дивізіони за рівнем гри. Початковий (Дивізіон I) — середній рейтинг команди 0–3500 MMR, при цьому жоден гравець основи не може мати більше 5500 MMR. Любительський (Дивізіон II) — середній рейтинг 0–7000 MMR, без обмежень по окремому гравцю. Аматорський (Дивізіон III) — середній рейтинг 7000+ MMR, без обмежень по гравцю. AVG рахується по п’яти гравцях основи (запасні не враховуються). Команда може заявитися в будь-який дивізіон, вимогам якого відповідає — тобто грати вище за свій рівень можна.'
```

- [ ] **Step 3: Type-check and lint**

```bash
cd /Users/olleyo/projects/CoreFrontend && npm run type-check && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/olleyo/projects/CoreFrontend
git add src/views/tournaments/Tournament.vue src/views/main/Main.vue
git commit -m "feat(divisions): join error copy and FAQ for the three-tier model"
```

---

## Manual verification

The backend has unit coverage for the rule table (Task 1) but no automated coverage for the join gate, and the frontend has no test framework at all. Verify by hand once both repos are running (`npm run start:dev` and `npm run dev`):

- [ ] Create a tournament with division **Аматорський (DIVISION_III)** — the option exists in the create form (Tasks 5, 7) and saves.
- [ ] A team averaging ≤ 3500 with every player ≤ 5500 can join a **Початковий** tournament.
- [ ] The same team can also join a **Любительський** tournament. This is playing up, and it is the behaviour the whole change exists for.
- [ ] The same team **cannot** join an **Аматорський** tournament; the error names the average.
- [ ] A team averaging ≤ 3500 with one player at 6000 is rejected from **Початковий**, and the error names the player's MMR and the 5500 limit — not the average.
- [ ] That same team joins **Любительський** successfully.
- [ ] A team's card, profile and AVG tooltip all show the **same** number (Task 8 — today the tooltip disagrees because it counts reserves).
- [ ] The admin "add team" list for a Любительський tournament includes teams whose own badge reads Початковий (Task 9).
