/**
 * BO3 із графа prerequisite у Challonge, без «красивих» назв раундів.
 *
 * Grand final — вузол, який ніде не фігурує як upstream prerequisite (фінальний sink).
 *
 * Double elimination (один матч GF):
 * - Принаймні одна нижча гілка: round < 0 або слот із player*_is_prereq_match_loser.
 * - Feeders GF (дві ноги перед фіналом):
 *   1) за прапорами loser на самих feeders;
 *   2) інакше round > 0 vs < 0;
 *   3) інакше обхід предків prerequisite: лише нижній фінал досягає матчів із round < 0.
 *
 * Single elimination — лише grand final є BO3.
 */

export type FinalsSlotKind =
  | 'upper_bracket_final'
  | 'lower_bracket_final'
  | 'grand_final';

export interface PrerequisiteLink {
  upstreamMatchId: number;
  /** true = слот тягне outcome LOSER із upstream */
  feedsFromUpstreamLoser: boolean;
}

export interface ChallongeBracketMatchNode {
  id: number;
  round: number;
  prerequisiteMatchIds: number[];
  prerequisiteLinks?: PrerequisiteLink[];
}

function coercePositiveInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0)
    return Math.trunc(v);
  if (typeof v === 'string') {
    const n = Number(v.trim());
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

function coerceBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  return undefined;
}

function parsePrerequisiteCsv(csv: unknown): number[] {
  if (csv === null || csv === undefined || csv === '') return [];
  if (typeof csv !== 'string') return [];
  const out: number[] = [];
  for (const chunk of csv.split(/[,;/\s]+/)) {
    const n = coercePositiveInt(chunk);
    if (n !== null) out.push(n);
  }
  return out;
}

/** Витяг id з вкладених JSON:API структур */
function collectNestedIds(nums: Set<number>, v: unknown): void {
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
    for (const x of v) collectNestedIds(nums, x);
    return;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('id' in o) collectNestedIds(nums, o.id);
    if ('data' in o) collectNestedIds(nums, o.data);
  }
}

/**
 * Арки prerequisite на слоти гравця (для loser vs winner lineage).
 */
export function extractPrerequisiteLinks(match: {
  attributes?: Record<string, unknown> | null | undefined;
  relationships?: Record<string, unknown> | null | undefined;
}): PrerequisiteLink[] {
  const attrs = match.attributes ?? {};
  const bySlot = new Map<number, PrerequisiteLink>();

  const ingestSlot = (
    slot: number,
    matchIdRaw: unknown,
    loserRaw?: unknown,
  ): void => {
    const mid = coercePositiveInt(matchIdRaw);
    if (mid === null) return;
    const loserB = coerceBool(loserRaw);
    const feedsFromUpstreamLoser = loserB === true;
    const prev = bySlot.get(slot);
    bySlot.set(slot, {
      upstreamMatchId: mid,
      feedsFromUpstreamLoser:
        feedsFromUpstreamLoser || !!prev?.feedsFromUpstreamLoser,
    });
  };

  const lowerMap = new Map(
    Object.keys(attrs).map((k) => [k.toLowerCase(), attrs[k]]),
  );

  const findVal = (variants: string[]): unknown =>
    variants
      .map((vk) => lowerMap.get(vk.toLowerCase()))
      .find((vv) => vv !== undefined);

  for (let slot = 1; slot <= 2; slot += 1) {
    const p = `player${slot}`;
    ingestSlot(
      slot,
      findVal([
        `${p}_prereq_match_id`,
        `${p}_prerequisite_match_id`,
        `${p}_prerequisite_match_uuid`,
        `${p}_prereq_match_uuid`,
        `${p}-prereq-match-id`,
        `${p}-prerequisite-match-id`,
      ]),
      findVal([
        `${p}_is_prereq_match_loser`,
        `${p}_is_prerequisite_match_loser`,
        `${p}-is-prereq-match-loser`,
      ]),
    );
  }

  const keyHints = /^player[12].*(prerequisite|prereq)/i;
  const slotFromKeyKey = /^player([12])[._-]/i;

  for (const [key, val] of Object.entries(attrs)) {
    const lk = key.toLowerCase();
    const looksLikeUpstreamRef =
      (keyHints.test(key) ||
        lk.includes('prerequisite_match') ||
        lk.includes('prereq_match')) &&
      /\b(match|uuid|id)s?\b/.test(lk);
    if (!looksLikeUpstreamRef) continue;

    const m = lk.match(slotFromKeyKey);
    const slotNum = m ? Number(m[1]) : NaN;

    const temp = new Set<number>();
    collectNestedIds(temp, val);
    const inferredLoserHint =
      lk.includes('loser') && !/\b(is_)?winner\b/i.test(lk);

    if (slotNum === 1 || slotNum === 2) {
      for (const nid of temp)
        ingestSlot(slotNum, nid, inferredLoserHint || undefined);
    }
  }

  return [...bySlot.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, link]) => link);
}

/** Усі upstream id prerequisite для узла матчу (включно з CSV). */
export function extractPrerequisiteParentMatchIds(match: {
  attributes?: Record<string, unknown> | null | undefined;
  relationships?: Record<string, unknown> | null | undefined;
}): number[] {
  const ids = new Set<number>();
  for (const l of extractPrerequisiteLinks(match)) ids.add(l.upstreamMatchId);

  const attrs = match.attributes ?? {};
  const csvVariants = [
    'prerequisite_match_ids_csv',
    'prerequisite-match-ids-csv',
  ] as const;

  for (const ck of csvVariants) {
    const raw = attrs[ck];
    if (raw !== undefined)
      for (const n of parsePrerequisiteCsv(raw)) ids.add(n);
  }

  const keyHints = /^player[12].*(prerequisite|prereq)/i;
  for (const [key, val] of Object.entries(attrs)) {
    const lk = key.toLowerCase();
    const looksLikeUpstreamRef =
      (keyHints.test(key) ||
        lk.includes('prerequisite_match') ||
        lk.includes('prereq_match') ||
        (/\bplayer[12][._-]/.test(lk) &&
          lk.includes('match') &&
          (lk.includes('pre') ||
            lk.includes('prior') ||
            lk.includes('parent') ||
            lk.includes('from')))) &&
      /\b(match|uuid|id)s?\b/.test(lk);
    if (!looksLikeUpstreamRef) continue;

    collectNestedIds(ids, val);
  }

  const rel = match.relationships ?? {};
  const relKeyHints =
    /prerequisite|upstream|prior|dependency|depends|parents|ancestor/i;

  for (const [rk, rval] of Object.entries(rel)) {
    if (!relKeyHints.test(rk)) continue;
    collectNestedIds(ids, rval);
    if (typeof rval === 'object' && rval !== null && 'links' in rval)
      collectNestedIds(ids, (rval as { links?: unknown }).links);
  }

  return [...ids];
}

function feederReceivesUpstreamLoser(
  feeder: ChallongeBracketMatchNode,
): boolean {
  return !!(feeder.prerequisiteLinks ?? []).some(
    (l) => l.feedsFromUpstreamLoser,
  );
}

/** DFS upstream по prerequisite ids: чи є предок із round < 0 */
function ancestralTouchesLosersStripe(
  feeder: ChallongeBracketMatchNode,
  byId: Map<number, ChallongeBracketMatchNode>,
): boolean {
  const seen = new Set<number>();
  const stack = [...feeder.prerequisiteMatchIds.filter((pid) => byId.has(pid))];

  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);

    const n = byId.get(pid);
    if (!n) continue;
    if (typeof n.round === 'number' && n.round < 0) return true;
    for (const up of n.prerequisiteMatchIds) {
      if (byId.has(up)) stack.push(up);
    }
  }
  return false;
}

function classifyDeFinalFeeders(
  feeders: ChallongeBracketMatchNode[],
  byId: Map<number, ChallongeBracketMatchNode>,
): {
  ubFinal?: ChallongeBracketMatchNode;
  lbFinal?: ChallongeBracketMatchNode;
} {
  const loserFlagged = feeders.filter(feederReceivesUpstreamLoser);
  const winnerOnly = feeders.filter((f) => !feederReceivesUpstreamLoser(f));
  if (loserFlagged.length === 1 && winnerOnly.length === 1) {
    return { lbFinal: loserFlagged[0], ubFinal: winnerOnly[0] };
  }

  const pos = feeders.filter((f) => f.round > 0);
  const neg = feeders.filter((f) => f.round < 0);
  if (pos.length === 1 && neg.length === 1) {
    return {
      ubFinal: pos[0],
      lbFinal: neg[0],
    };
  }

  const negAncest = feeders.filter((f) =>
    ancestralTouchesLosersStripe(f, byId),
  );
  const posAncest = feeders.filter(
    (f) => !ancestralTouchesLosersStripe(f, byId),
  );

  if (negAncest.length === 1 && posAncest.length === 1) {
    return { lbFinal: negAncest[0], ubFinal: posAncest[0] };
  }

  return {};
}

export interface ResolvedFinalsBo3 {
  bo3MatchIds: Set<number>;
  slotByMatchId: Map<number, FinalsSlotKind>;
}

export function resolveStructuralFinalBo3Slots(
  nodes: ChallongeBracketMatchNode[],
): ResolvedFinalsBo3 {
  const empty: ResolvedFinalsBo3 = {
    bo3MatchIds: new Set(),
    slotByMatchId: new Map(),
  };
  if (nodes.length === 0) return empty;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const referencedUpstream = new Set<number>();

  for (const n of nodes) {
    for (const pid of n.prerequisiteMatchIds) {
      if (Number.isFinite(pid) && pid > 0 && byId.has(pid))
        referencedUpstream.add(pid);
    }
  }

  const dangling = nodes.filter((n) => !referencedUpstream.has(n.id));
  const gfCandidates = dangling
    .filter((n) => n.prerequisiteMatchIds.length >= 2)
    .sort((a, b) => b.round - a.round);

  if (gfCandidates.length === 0) return empty;

  const anyNegativeRoundBrackets = nodes.some((n) => n.round < 0);
  const anyLoserSlotLink = nodes.some((n) =>
    (n.prerequisiteLinks ?? []).some((l) => l.feedsFromUpstreamLoser),
  );
  /** SE: усі матчі вижившої частини зазвичай round ≥ 0 і нема loser-слотів */
  const doubleElim = anyNegativeRoundBrackets || anyLoserSlotLink;

  const bo3Ids = new Set<number>();
  const slotByMatchId = new Map<number, FinalsSlotKind>();

  for (const gf of gfCandidates) {
    bo3Ids.add(gf.id);
    slotByMatchId.set(gf.id, 'grand_final');

    const feederIds = [...new Set(gf.prerequisiteMatchIds)].filter((fid) =>
      byId.has(fid),
    );
    const feeders = feederIds.map((id) => byId.get(id)!).filter(Boolean);
    if (!doubleElim || feeders.length < 2) continue;

    let { ubFinal, lbFinal } = classifyDeFinalFeeders(feeders, byId);

    /**
     * Останній рубіж: два фідери — це UB/LB final у стандартному DE.
     * Якщо Challonge вкинув неконсистентні round/поля, усе одно познач обидва як BO3.
     */
    if (feeders.length === 2 && (!ubFinal || !lbFinal)) {
      const [a, b] = feeders;
      const ta = ancestralTouchesLosersStripe(a, byId);
      const tb = ancestralTouchesLosersStripe(b, byId);
      if (ta !== tb) {
        lbFinal = ta ? a : b;
        ubFinal = ta ? b : a;
      } else {
        ubFinal = a;
        lbFinal = b;
      }
    }

    if (ubFinal) {
      bo3Ids.add(ubFinal.id);
      slotByMatchId.set(ubFinal.id, 'upper_bracket_final');
    }
    if (lbFinal && lbFinal.id !== ubFinal?.id) {
      bo3Ids.add(lbFinal.id);
      slotByMatchId.set(lbFinal.id, 'lower_bracket_final');
    }
  }

  return { bo3MatchIds: bo3Ids, slotByMatchId };
}
