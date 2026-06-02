import { Injectable } from '@nestjs/common';
import { ForecastConfigRepository } from '../../repos/forecast-config.repository';
import {
  ForecastConfigSchema,
  type ForecastConfig,
  type ForecastDivisionResult,
  type ForecastResult,
} from '../../types/entities/finance/forecast';

/** Five players make up a team; entry fees are charged per player. */
const PLAYERS_PER_TEAM = 5;

/**
 * Round a kopeck amount **down to whole hundreds of UAH** (1 UAH = 100 kopecks,
 * so 100 UAH = 10 000 kopecks), per the "заокруглення вниз до сотень" rule.
 */
const HUNDREDS_UAH_IN_KOPECKS = 100 * 100;
function floorToHundredsUah(kopecks: number): number {
  return (
    Math.floor(kopecks / HUNDREDS_UAH_IN_KOPECKS) * HUNDREDS_UAH_IN_KOPECKS
  );
}

/**
 * Pure prize-pool forecast over a {@link ForecastConfig}, plus a thin
 * persistence wrapper so the feed and balance can read the single active config.
 *
 * Formula (kopecks throughout). The three divisions are charged the three fee
 * tiers in order (division 0 → `top1_4`, 1 → `top5_8`, 2 → `top8plus`):
 * - `collected[d] = teamCount[d] · PLAYERS_PER_TEAM · feeTier[d]`
 * - `totalCollected = Σ collected[d]`
 * - global prize pool = `totalCollected · prizePoolPercent%`, split across
 *   divisions in proportion to their `collected`
 * - `prizePool[d] = floorToHundredsUah(projectContribution[d] + share[d])`
 * - `projectedExpenses = totalPrizePool`,
 *   `projectedProfit = totalCollected · (100 − prizePoolPercent)%`
 *
 * NOTE: the fee-tier↔division mapping and the "hundreds" unit are an explicit
 * interpretation of the spec — adjust here if the business formula differs.
 */
@Injectable()
export class ForecastCalculatorService {
  constructor(private readonly configRepo: ForecastConfigRepository) {}

  calculate(config: ForecastConfig): ForecastResult {
    const parsed = ForecastConfigSchema.parse(config);
    const feeTiers = [
      parsed.fees.top1_4,
      parsed.fees.top5_8,
      parsed.fees.top8plus,
    ];

    const collected = parsed.divisions.map(
      (division, i) => division.teamCount * PLAYERS_PER_TEAM * feeTiers[i],
    );
    const totalCollected = collected.reduce((sum, c) => sum + c, 0);
    const globalPrizePool = Math.floor(
      (totalCollected * parsed.prizePoolPercent) / 100,
    );

    const divisions = parsed.divisions.map(
      (division, i): ForecastDivisionResult => {
        const share =
          totalCollected > 0
            ? Math.floor((globalPrizePool * collected[i]) / totalCollected)
            : 0;
        return {
          collected: collected[i],
          prizePool: floorToHundredsUah(division.projectContribution + share),
        };
      },
    ) as [
      ForecastDivisionResult,
      ForecastDivisionResult,
      ForecastDivisionResult,
    ];

    const totalPrizePool = divisions.reduce((sum, d) => sum + d.prizePool, 0);
    const projectedProfit = Math.floor(
      (totalCollected * (100 - parsed.prizePoolPercent)) / 100,
    );

    return {
      divisions,
      totalCollected,
      totalPrizePool,
      projectedExpenses: totalPrizePool,
      projectedProfit,
    };
  }

  /** The active config and its computed result, or `null` if none is set. */
  async getActive(): Promise<{
    config: ForecastConfig;
    result: ForecastResult;
  } | null> {
    const config = await this.configRepo.getActive();
    if (!config) return null;
    return { config, result: this.calculate(config) };
  }

  async setActive(config: ForecastConfig): Promise<{
    config: ForecastConfig;
    result: ForecastResult;
  }> {
    const saved = await this.configRepo.setActive(
      ForecastConfigSchema.parse(config),
    );
    return { config: saved, result: this.calculate(saved) };
  }
}
