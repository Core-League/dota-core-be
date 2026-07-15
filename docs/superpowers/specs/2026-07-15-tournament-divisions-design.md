# Tournament divisions: three tiers, range-based eligibility, exposed AVG

Date: 2026-07-15
Repos: `dota-core-be` (v1) and `CoreFrontend`

## Problem

The division model is two-tier and average-only: `avg ≤ 6500 → DIVISION_I (Аматорський)`,
`avg > 6500 → DIVISION_II (Професійний)`. `DIVISION_III` is retired. Teams may only join a
tournament whose division exactly equals their own computed division.

Three things are wrong for the new season:

1. The tier names and thresholds are changing, and a third tier returns.
2. A per-player MMR ceiling must return for the lowest tier. It existed once and was
   deliberately removed in commit `8f3a618` ("average-only two-division model").
3. Teams cannot play up. The new ranges overlap by design (`0–3500` and `0–7000`), which
   strict equality cannot express.

## Target model

| Key            | Label (UA)      | AVG range    | Per-player cap |
| -------------- | --------------- | ------------ | -------------- |
| `DIVISION_I`   | Початковий      | 0 – 3500     | 5500           |
| `DIVISION_II`  | Любительський   | 0 – 7000     | none           |
| `DIVISION_III` | Аматорський     | 7000+        | none           |

Notes on the naming, confirmed with the product owner:

- "Аматорський" **moves from the lowest tier to the highest**. This is intentional, not a
  slip. Anyone reading old code or old tournament names must not assume continuity of that word.
- The enum keys keep their ordinal meaning (I < II < III in strength), so the ordering is
  preserved even though every tier's definition changed.

### Decisions

- **Eligibility is range-based; playing up is allowed.** A team may join any division whose
  requirements it satisfies. A roster averaging 2000 with all players ≤ 5500 may enter both
  Початковий and Любительський. It may not enter Аматорський, because 7000 is a floor, not a
  hint.
- **Bounds are inclusive on both ends.** An average of exactly 7000 therefore satisfies both
  Любительський (`maxAvg: 7000`) and Аматорський (`minAvg: 7000`). Under play-up this overlap
  is harmless: the team may enter either, and its card shows Любительський (the lower match).
- **Qualifications do not change structurally.** They carry no division of their own — they
  inherit the tournament's. Round-robin generation, points, and the 1–4 / 5–8 / 9+ leaderboard
  blocks are untouched. Only roster and substitute validation shift onto the new rules.
- **No data migration.** Existing tournaments keep their division keys and are simply relabelled
  under the new meanings. Every tournament currently in the database is already `PLAYOFF`, so
  registration is closed and no in-flight join can break.
- **No DB migration.** `tournament_division_enum` already contains all three values
  (`src/migrations/1780358677674-InitialSchema.ts:17`), the Discord category for `DIVISION_III`
  already exists (`src/discord/discord-bot.service.ts:15`), and seed data already has a
  `DIVISION_III` tournament. Reviving the tier is application-code only.

## Design

### Separating eligibility from display

Today one function does both jobs, which is precisely what makes play-up impossible: a team's
*identity* and a team's *permission* are the same value, so permission can only ever be equality.
Splitting them is the heart of this change.

`src/tournaments/tournament-division.util.ts` becomes the single source of truth:

```ts
export interface DivisionRule {
  label: string;
  minAvg: number;                 // inclusive
  maxAvg: number | null;          // inclusive; null = unbounded
  maxPlayerRating: number | null; // inclusive; null = no cap
}

export const DIVISION_RULES: Record<TournamentDivision, DivisionRule> = {
  [TournamentDivision.DIVISION_I]:   { label: 'Початковий',    minAvg: 0,    maxAvg: 3500, maxPlayerRating: 5500 },
  [TournamentDivision.DIVISION_II]:  { label: 'Любительський', minAvg: 0,    maxAvg: 7000, maxPlayerRating: null },
  [TournamentDivision.DIVISION_III]: { label: 'Аматорський',   minAvg: 7000, maxAvg: null, maxPlayerRating: null },
};
```

exposing three functions with distinct responsibilities:

- `computeTeamAvgRating(players): number | null` — the average, or `null` for an empty roster.
  Today this number is computed at line 17 and discarded; nothing downstream can show it.
- `isTeamEligibleForDivision(players, division): boolean` — the authority for joining.
- `resolveTeamDivision(players): TournamentDivision | null` — the **lowest** division the roster
  matches. Display and Discord category only. Never consulted for eligibility.

`computeTeamDivision` is deleted; `resolveTeamDivision` takes over its three call sites
(`teams.service.ts:770`, `teams.service.ts:132`, `admin.service.ts:352`).

Every non-empty roster matches at least one division: `DIVISION_II` accepts any average ≤ 7000
regardless of player ratings, and `DIVISION_III` accepts everything from 7000 up. `resolveTeamDivision`
therefore returns `null` only for an empty roster.

A consequence for the join gate: the current "Рейтинг команди виходить за межі дозволених
дивізіонів" error guards `computeTeamDivision` returning `null`, which under the new model can only
mean an empty roster. `isTeamEligibleForDivision` would fold that case into a generic ineligibility
failure and report it as an MMR problem, which it is not. The empty-roster check therefore stays
separate and explicit, ahead of the eligibility call, with a message naming the real cause
(no main players). Note the existing all-players-verified check at `:228-233` passes vacuously on an
empty roster and does not cover this.

### Join gate

`src/qualification/qualification.service.ts:235-245` drops the equality check for
`isTeamEligibleForDivision(main, tournament.division)`.

The rejection message must state **which** rule failed — average out of range, or a player over the
cap. These are different user problems with different fixes, and the frontend keys its friendly
hints off exact backend strings (`Tournament.vue:360-384`), so an undifferentiated message leaves a
captain unable to tell "your team is too strong" from "one player is too strong".

### Substitute validation

`validateSubstitute` (`qualification.service.ts:613`) currently proves safety by checking that
replacing the lowest- and highest-rated starter both leave the division unchanged — every other
slot lands between those two extremes, because division is a monotonic threshold on the average.

Re-introducing a per-player cap does **not** break this argument; the predicate decomposes:

- **Cap** is a flat property of the multiset. Given every starter is already under the cap, the
  post-substitution roster is under it iff `sub.rating <= cap`. Independent of who is replaced.
- **Average** still varies monotonically between "replace the lowest" (maximises) and "replace the
  highest" (minimises). If both extremes fall inside `[minAvg, maxAvg]`, so does every intermediate.

So the two-sided check survives, with two changes: it validates against **the tournament's**
division rather than against division-invariance, and it gains a cap check on the substitute.
This requires threading `tournament.division` into the signature — the function currently takes
only `(mainPlayers, sub)`.

Validating against the tournament rather than invariance is also more correct under play-up: a sub
that shifts a team's *resolved* division is fine as long as the roster still satisfies the
tournament it is actually entering.

### Exposing the average

`TeamResponseDto` gains `avgRating: number | null` beside the existing `division`.

The frontend currently reduces the average in four places that **disagree with each other**:
`TeamCard.vue:180`, `TeamRoster.vue:324`, and `TeamProfileCard.vue:212` average main players only,
while `TeamAvg.vue:14` averages mains **plus reserves**. The same team shows one AVG on its card and
a different one in the AVG tooltip. They also round inconsistently with the admin filter
(`TournamentAdminTab.vue:263` compares an unrounded average), so a team at 6500.4 can classify
differently in two places on the same screen.

One server-computed number removes all four copies and the class of bug with them.

### Un-retiring DIVISION_III

`src/tournaments/dto/create-tournament.dto.ts:43-49` restores `DIVISION_III` to its `@IsIn` list and
drops the "retired" wording from the Swagger description.

## Frontend changes

`src/components/tournaments-tags/tournament.constants.ts` mirrors the rule table.
`DIVISION_AVG_MMR_THRESHOLD` and `inferTournamentDivisionFromAvgRating` are deleted with it.

- `tournamentDivisionLabelMap` → the new names. `DIVISION_III` stops being "Дивізіон III".
- `tournamentDivisionMmrHintMap` → new ranges, including the 5500 player cap for Початковий, which
  no hint has ever had to express before.
- `TOURNAMENT_DIVISION_CREATE_VALUES` regains `DIVISION_III`.
- `resolveTeamDivisionForDisplay` loses its DIVISION_III-is-legacy branch and simply prefers the
  API's `division`, falling back to the local rule table.
- The four duplicated averages are replaced by the API's `avgRating`.
- `TournamentAdminTab.vue:263` (`eligibleTeams`) switches from equality to the eligibility
  predicate. Otherwise admins could not add a playing-up team that the public join flow accepts —
  the two paths would contradict each other.
- `Tournament.vue:360-384` join error map gains the new backend strings.
- `Main.vue:519` FAQ prose is rewritten: it hardcodes "Аматорський (Дивізіон I) — 0–6500;
  Професійний (Дивізіон II) — 6500+" independently of the constants.

Styling (`tournamentDivisionTagClassMap`, `tournamentDivisionCardChipClassMap`) already covers all
three keys — cyan / fuchsia / amber — and needs no change.

## Testing

`tournament-division.util.spec.ts` is rewritten; every existing case asserts the old 6500 model and
one explicitly asserts `DIVISION_III` is never produced. New coverage:

- Each tier's boundaries: 3500 and 3501; 7000 and 7001.
- The 5500 cap: a roster averaging 2000 with a 6000-rated player is **not** eligible for Початковий
  but **is** for Любительський. This is the case the whole change exists for.
- The cap boundary at exactly 5500 (eligible).
- Play-up: an average-2000 all-under-cap roster is eligible for both I and II, and not for III.
- `resolveTeamDivision` returns the lowest match, and `null` only for an empty roster.
- Overlap at exactly 7000: eligible for II and III, resolves to II.
- Substitute validation against a tournament division, including a sub above the cap for a
  `DIVISION_I` tournament and a sub that shifts the resolved division but keeps the roster eligible.

## Out of scope

- `src/views/tournaments/tournaments.enums.ts:47` — a stale five-division list feeding a drawer whose
  own data source is a `// TODO: endpoint not in API yet` stub. Dead, but not ours to remove here.
- `TournamentFilterModal.vue:85` — the permanently-empty division filter that still serialises a
  `division` query param. Pre-existing.
- The `player.rating` `real`-vs-`int` inconsistency (float column, integer writers).
- The unrelated cosmetic rank/tier medal system (`rank-system/`).
