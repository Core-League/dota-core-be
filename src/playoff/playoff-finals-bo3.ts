/**
 * BO3 finals classification for Challonge brackets using prerequisite topology:
 * matches that feed downstream slots appear as prerequisite/parent refs on children.
 *
 * Championship match(es) ("grand finals") never appear as another match's
 * prerequisite upstream id — Challonge never schedules play after the champ is decided,
 * ignoring optional bracket-reset row which is modeled as its own non-referenced GF.
 *
 * Upper / lower finals for double elimination are the two feeders of the GF when
 * one feeder comes from winners (round > 0) and one from losers (round < 0).
 */

/** Explicit finals slot tagging for callers (UI / logging); BO3-only types. */
export type FinalsSlotKind =
  | 'upper_bracket_final'
  | 'lower_bracket_final'
  | 'grand_final';

/** One bracket node plus upstream prerequisite match ids Challonge attaches to it. */
export interface ChallongeBracketMatchNode {
  id: number;
  round: number;
  /** Parent match ids feeding this node's participant slots (winners bracket / losers / etc.). */
  prerequisiteMatchIds: number[];
}

/** Pull numeric upstream match ids out of Challonge JSON:API match payload. */
export function extractPrerequisiteParentMatchIds(match: {
  attributes?: Record<string, unknown> | null | undefined;
  relationships?: Record<string, unknown> | null | undefined;
}): number[] {
  const nums = new Set<number>();
  const consider = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      nums.add(Math.trunc(v));
      return;
    }
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) nums.add(Math.trunc(n));
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) consider(x);
      return;
    }
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('id' in o) consider(o.id);
      if ('data' in o) consider(o.data);
      return;
    }
  };

  const attrs = match.attributes ?? {};

  const keyHints = /^player[12].*(prerequisite|prereq)/i;

  for (const [key, val] of Object.entries(attrs)) {
    const lk = key.toLowerCase();

    const looksLikeUpstreamRef =
      (keyHints.test(key) ||
        lk.includes('prerequisite_match') ||
        lk.includes('prereq_match') ||
        (/\bplayer[12]_/.test(lk) &&
          lk.includes('match') &&
          (lk.includes('pre') ||
            lk.includes('prior') ||
            lk.includes('parent') ||
            lk.includes('from')))) &&
      /\b(match|uuid|id)s?\b/.test(lk);

    if (!looksLikeUpstreamRef) continue;

    consider(val);
  }
  const rel = match.relationships ?? {};

  const relKeyHints =
    /prerequisite|upstream|prior|dependency|depends|parents|ancestor/i;

  for (const [key, val] of Object.entries(rel)) {
    if (!relKeyHints.test(key)) continue;

    consider(val);

    if (typeof val === 'object' && val !== null && 'links' in val) {
      const linksVal = (val as { links?: unknown }).links;
      consider(linksVal);
    }
  }

  return [...nums];
}

export interface ResolvedFinalsBo3 {
  /** Challonge ids that Core must treat as BO3. */
  bo3MatchIds: Set<number>;
  /** Optional per-id slot labels (omit when unknown / SE-only GF). */
  slotByMatchId: Map<number, FinalsSlotKind>;
}

/**
 * Decide which Challonge bracket nodes receive BO3.
 *
 * - Double elimination (`any round < 0`): UB final, LB final, grand final only.
 * - Single elimination (`all rounds >= 0`): grand final only.
 *
 * Prerequisites must be populated in `prerequisiteMatchIds`; if the graph cannot be read,
 * returns an empty BO3 set (everything stays BO1) — callers may log loudly.
 */
export function resolveStructuralFinalBo3Slots(
  nodes: ChallongeBracketMatchNode[],
): ResolvedFinalsBo3 {
  const empty: ResolvedFinalsBo3 = {
    bo3MatchIds: new Set(),
    slotByMatchId: new Map(),
  };
  if (nodes.length === 0) return empty;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const prerequisiteIdsReferencedElsewhere = new Set<number>();

  for (const n of nodes) {
    for (const pid of n.prerequisiteMatchIds) {
      if (Number.isFinite(pid) && pid > 0 && byId.has(pid)) {
        prerequisiteIdsReferencedElsewhere.add(pid);
      }
    }
  }

  /** Matches never listed as an upstream prerequisite of another bracket node — typically champ slot(s). */
  const dangling = nodes.filter(
    (n) => !prerequisiteIdsReferencedElsewhere.has(n.id),
  );

  const grandFinalCandidates = dangling
    .filter((n) => n.prerequisiteMatchIds.length >= 2)
    .sort((a, b) => b.round - a.round);

  if (grandFinalCandidates.length === 0) return empty;

  const doubleElim = nodes.some((n) => n.round < 0);
  const bo3Ids = new Set<number>();
  const slotByMatchId = new Map<number, FinalsSlotKind>();

  for (const gf of grandFinalCandidates) {
    bo3Ids.add(gf.id);
    slotByMatchId.set(gf.id, 'grand_final');

    if (!doubleElim) {
      continue;
    }

    const feederIds = [...new Set(gf.prerequisiteMatchIds)].filter((fid) =>
      byId.has(fid),
    );

    /** Normal DE champ match has UB + LB legs; if prerequisites are malformed, GF alone is BO3. */
    const feeders = feederIds.map((fid) => byId.get(fid)!).filter(Boolean);

    if (feeders.length < 2) continue;

    const winnersSide = feeders.filter((f) => f.round > 0);
    const losersSide = feeders.filter((f) => f.round < 0);

    if (
      losersSide.length === 0 ||
      winnersSide.length === feeders.length ||
      feeders.every((f) => f.round > 0)
    ) {
      /** Semis-feeding GF in pure single-elim tree — UB/LB tagging not applicable here. */
      continue;
    }

    const ubFinal = winnersSide.sort((a, b) => b.round - a.round)[0];
    const lbFinal = losersSide.sort((a, b) => b.round - a.round)[0];

    if (ubFinal) {
      bo3Ids.add(ubFinal.id);
      slotByMatchId.set(ubFinal.id, 'upper_bracket_final');
    }
    if (lbFinal) {
      bo3Ids.add(lbFinal.id);
      slotByMatchId.set(lbFinal.id, 'lower_bracket_final');
    }
  }

  return { bo3MatchIds: bo3Ids, slotByMatchId };
}
