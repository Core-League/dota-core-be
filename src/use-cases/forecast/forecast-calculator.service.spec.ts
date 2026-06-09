import { ForecastConfig } from '../../types/entities/finance/forecast';
import { ForecastCalculatorService } from './forecast-calculator.service';

//TODO: add mock
const svc = new ForecastCalculatorService(null as any);

/**
 * 3 leagues × 9 teams each. Fee is per-player (5 players/team).
 * Divisions are tier groups across all leagues:
 *   div0 top1_4:  4 teams/league × 3 = 12 teams, 500 UAH/team (100 UAH/player)
 *   div1 top5_8:  4 teams/league × 3 = 12 teams, 750 UAH/team (150 UAH/player)
 *   div2 top8plus:1 team/league  × 3 =  3 teams,1000 UAH/team (200 UAH/player)
 * Org contributions (2:3:5 ratio, total 3 600 UAH): 720 / 1 080 / 1 800 UAH.
 * prizePoolPercent: 60 %
 */
const REAL_WORLD_CONFIG: ForecastConfig = {
  fees: { top1_4: 10_000, top5_8: 15_000, top8plus: 20_000 },
  prizePoolPercent: 60,
  divisions: [
    { teamCount: 12, projectContribution: 72_000 },
    { teamCount: 12, projectContribution: 108_000 },
    { teamCount: 3, projectContribution: 180_000 },
  ],
};

describe('ForecastCalculatorService.calculate — real-world scenario', () => {
  let result: ReturnType<typeof svc.calculate>;

  beforeAll(() => {
    result = svc.calculate(REAL_WORLD_CONFIG);
  });

  it('collects 18 000 UAH from entry fees', () => {
    expect(result.totalCollected).toBe(1_800_000);
  });

  it('splits collected correctly per division', () => {
    expect(result.divisions[0].collected).toBe(600_000); // 6 000 UAH
    expect(result.divisions[1].collected).toBe(900_000); // 9 000 UAH
    expect(result.divisions[2].collected).toBe(300_000); // 3 000 UAH
  });

  it('prize pools include org contribution and are floored to 100 UAH', () => {
    expect(result.divisions[0].prizePool).toBe(430_000); // 4 300 UAH
    expect(result.divisions[1].prizePool).toBe(640_000); // 6 400 UAH
    expect(result.divisions[2].prizePool).toBe(360_000); // 3 600 UAH
  });

  it('total prize pool is 14 300 UAH', () => {
    expect(result.totalPrizePool).toBe(1_430_000);
  });

  it('projectedExpenses equals totalPrizePool', () => {
    expect(result.projectedExpenses).toBe(result.totalPrizePool);
  });

  it('profit is 3 700 UAH (3 600 fee surplus + 100 UAH saved by flooring)', () => {
    expect(result.projectedProfit).toBe(370_000);
  });

  it('profit + expenses balance against collected', () => {
    expect(result.projectedProfit + result.totalPrizePool).toBe(
      result.totalCollected,
    );
  });
});
