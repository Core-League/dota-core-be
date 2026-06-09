import { ForecastCalculatorService } from './forecast-calculator.service';
import type { ForecastConfigRepository } from '../../repos/forecast-config.repository';
import type { ForecastConfig } from '../../types/entities/finance/forecast';

describe('ForecastCalculatorService.calculate', () => {
  const service = new ForecastCalculatorService(
    null as unknown as ForecastConfigRepository,
  );

  /**
   * Deliberately messy scenario (all kopecks, expectations derived by hand):
   * - non-round per-player fees: 137.50 / 92.25 / 61.75 UAH
   * - 13 teams (fills all three brackets: 4 + 4 + 5)
   * -  7 teams (partial middle bracket: 4 + 3 + 0)
   * -  2 teams (partial top bracket:    2 + 0 + 0)
   * - odd contributions and a 47 % pool so flooring kicks in everywhere
   */
  const complexConfig: ForecastConfig = {
    fees: { top1_4: 137_50, top5_8: 92_25, top8plus: 61_75 },
    prizePoolPercent: 47,
    divisions: [
      { teamCount: 13, projectContribution: 12_34_56 },
      { teamCount: 7, projectContribution: 7_89_01 },
      { teamCount: 2, projectContribution: 25_00_00 },
    ],
  };

  let result: ReturnType<typeof service.calculate>;

  beforeAll(() => {
    result = service.calculate(complexConfig);
  });

  it('charges each placement bracket its own fee, 5 players per team', () => {
    // 13 teams → 5·(4·13750 + 4·9225 + 5·6175)
    expect(result.divisions[0].collected).toBe(613_875);
    //  7 teams → 5·(4·13750 + 3·9225)
    expect(result.divisions[1].collected).toBe(413_375);
    //  2 teams → 5·(2·13750)
    expect(result.divisions[2].collected).toBe(137_500);
    expect(result.totalCollected).toBe(1_164_750);
  });

  it('splits a floored 47 % global pool pro-rata to collections', () => {
    // pool = floor(1 164 750 · 0.47) = floor(547 432.5) = 547 432
    // shares = floor(pool · collected[i] / total) = 288 520 / 194 286 / 64 624
    // (sum 547 430 — flooring may strand kopecks, but never over-allocates)
    // prizePool[i] = floorToHundredsUah(contribution[i] + share[i]):
    expect(result.divisions[0].prizePool).toBe(410_000); // 123 456 + 288 520 = 411 976
    expect(result.divisions[1].prizePool).toBe(270_000); //  78 901 + 194 286 = 273 187
    expect(result.divisions[2].prizePool).toBe(310_000); // 250 000 +  64 624 = 314 624
  });

  it('totals prize pools and mirrors them as projected expenses', () => {
    expect(result.totalPrizePool).toBe(990_000);
    expect(result.projectedExpenses).toBe(990_000);
  });

  it('projects profit as collections minus total prize pool', () => {
    expect(result.projectedProfit).toBe(174_750);
    expect(result.projectedProfit + result.totalPrizePool).toBe(
      result.totalCollected,
    );
  });

  it('keeps every amount a whole number of kopecks', () => {
    const amounts = [
      result.totalCollected,
      result.totalPrizePool,
      result.projectedExpenses,
      result.projectedProfit,
      ...result.divisions.flatMap((d) => [d.collected, d.prizePool]),
    ];
    for (const amount of amounts) expect(Number.isInteger(amount)).toBe(true);
    // prize pools are additionally whole hundreds of UAH
    for (const d of result.divisions) expect(d.prizePool % 100_00).toBe(0);
  });

  it('returns zeros when no teams are registered', () => {
    const empty = service.calculate({
      ...complexConfig,
      divisions: [
        { teamCount: 0, projectContribution: 0 },
        { teamCount: 0, projectContribution: 0 },
        { teamCount: 0, projectContribution: 0 },
      ],
    });

    expect(empty.totalCollected).toBe(0);
    expect(empty.totalPrizePool).toBe(0);
    expect(empty.projectedProfit).toBe(0);
  });
});
