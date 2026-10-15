/**
 * Pure single-elimination maths for `DuelBracketsService`: bracket size,
 * the standard seeding order (top seeds meet as late as possible, byes go to
 * them), where the slots of a later match come from, and final places.
 */

/** Rounds needed for `participants` players (at least one: the final). */
export function bracketRounds(participants: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, participants))));
}

/**
 * Standard seeding order of a bracket of `size` (a power of two): seed
 * numbers slot by slot, so that pairs (0,1), (2,3)… are round-one matches.
 * 8 → [1, 8, 4, 5, 2, 7, 3, 6]: 1 and 2 can only meet in the final.
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, next - seed]);
  }
  return order;
}

/** Round-one pairs as seed numbers; a seed above `participants` is a bye (null). */
export function firstRoundSeeds(
  participants: number,
): Array<[number | null, number | null]> {
  const size = 2 ** bracketRounds(participants);
  const order = seedOrder(size);
  const pairs: Array<[number | null, number | null]> = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = order[i];
    const b = order[i + 1];
    pairs.push([a <= participants ? a : null, b <= participants ? b : null]);
  }
  return pairs;
}

/** The third-place match exists when the bracket has semi-finals. */
export function hasThirdPlaceMatch(rounds: number): boolean {
  return rounds >= 2;
}

/** Minimal view of a match the place / slot maths needs. */
export interface BracketNode {
  round: number;
  position: number;
  isThirdPlace: boolean;
  /** Decided (DONE); `winnerId` / `loserId` may be null for an empty slot. */
  done: boolean;
  winnerId: string | null;
  loserId: string | null;
}

/**
 * Where slot `slot` (0 or 1) of a later-round match is fed from: the match of
 * the previous round and whether its winner or its loser moves on.
 */
export function slotSource(
  node: Pick<BracketNode, 'round' | 'position' | 'isThirdPlace'>,
  slot: 0 | 1,
): { round: number; position: number; takes: 'winner' | 'loser' } {
  if (node.isThirdPlace) {
    return { round: node.round - 1, position: slot, takes: 'loser' };
  }
  return {
    round: node.round - 1,
    position: node.position * 2 + slot,
    takes: 'winner',
  };
}

/**
 * Best place a knocked-out player finishes on. The champion is 1, the final
 * loser 2, the third-place match gives 3 and 4; earlier losers share a range
 * that starts here (quarter-final losers: 5, i.e. places 5–8). Semi-final
 * losers get their place from the third-place match, so none here.
 */
export function placeOfLoser(round: number, rounds: number): number | null {
  if (round === rounds) return 2;
  if (round === rounds - 1 && hasThirdPlaceMatch(rounds)) return null;
  return 2 ** (rounds - round) + 1;
}

/** Last place of the range that starts at `place` (5 → 8); the same place for 1–4. */
export function placeRangeEnd(place: number): number {
  return place <= 4 ? place : (place - 1) * 2;
}

/** Places of every player the decided matches have fixed so far. */
export function computePlaces(
  nodes: BracketNode[],
  rounds: number,
): Map<string, number> {
  const places = new Map<string, number>();
  for (const n of nodes) {
    if (!n.done) continue;
    if (n.isThirdPlace) {
      if (n.winnerId) places.set(n.winnerId, 3);
      if (n.loserId) places.set(n.loserId, 4);
      continue;
    }
    if (n.round === rounds && n.winnerId) places.set(n.winnerId, 1);
    const place = placeOfLoser(n.round, rounds);
    if (n.loserId && place != null) places.set(n.loserId, place);
  }
  return places;
}
