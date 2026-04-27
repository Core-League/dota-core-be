import {
  computeNumericRankName,
  resolvePlayerRankFromNumericRating,
} from './resolve-player-rank';

describe('resolvePlayerRankFromNumericRating', () => {
  it('recruit 1 star at 0 MMR', () => {
    const r = resolvePlayerRankFromNumericRating(0);
    expect(r.rankNumber).toBe(1);
    expect(r.stars).toBe(1);
    expect(r.numericName).toBe(11);
  });

  it('stays in tier until next min is reached (Legend 3 = 53)', () => {
    const r = resolvePlayerRankFromNumericRating(3390);
    expect(r.rankNumber).toBe(5);
    expect(r.stars).toBe(3);
    expect(r.numericName).toBe(53);
  });

  it('one below next threshold = previous tier', () => {
    const r = resolvePlayerRankFromNumericRating(3379);
    expect(r.rankNumber).toBe(5);
    expect(r.stars).toBe(2);
    expect(r.numericName).toBe(52);
  });

  it('Titan always returns numericName 81', () => {
    const a = resolvePlayerRankFromNumericRating(5620);
    const b = resolvePlayerRankFromNumericRating(12_000);
    expect(a.rankNumber).toBe(8);
    expect(b.rankNumber).toBe(8);
    expect(a.numericName).toBe(81);
    expect(b.numericName).toBe(81);
  });

  it('clamps negative rating to 0 path', () => {
    const r = resolvePlayerRankFromNumericRating(-100);
    expect(r.minRatingForTier).toBe(0);
  });
});

describe('computeNumericRankName', () => {
  it('Titan is always 81', () => {
    expect(computeNumericRankName(8, 1)).toBe(81);
    expect(computeNumericRankName(8, 5)).toBe(81);
  });

  it('non-titan = rank*10+stars', () => {
    expect(computeNumericRankName(5, 3)).toBe(53);
    expect(computeNumericRankName(6, 1)).toBe(61);
  });
});
