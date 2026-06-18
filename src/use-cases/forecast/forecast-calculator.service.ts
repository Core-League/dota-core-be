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

/** Round a kopeck amount down to whole hundreds of UAH (100 UAH = 10 000 kopecks). */
const HUNDREDS_UAH_IN_KOPECKS = 100 * 100;
function floorToHundredsUah(kopecks: number): number {
  return (
    Math.floor(kopecks / HUNDREDS_UAH_IN_KOPECKS) * HUNDREDS_UAH_IN_KOPECKS
  );
}

/**
 * Pure prize-pool forecast over a {@link ForecastConfig} + a thin persistence
 * wrapper for the single active config. Formula (kopecks throughout): within
 * each division the fee depends on a team's placement bracket — teams 1–4 pay
 * `fees.top1_4`, teams 5–8 pay `fees.top5_8`, teams 9+ pay `fees.top8plus` —
 * so `collected[d] = PLAYERS_PER_TEAM · Σ bracketTeams · bracketFee`. The
 * global pool `totalCollected · prizePoolPercent%` is split per division
 * pro-rata to `collected`, then `prizePool[d] =
 * floorToHundredsUah(projectContribution[d] + share[d])`.
 * `projectedProfit = totalCollected − totalPrizePool`.
 *
 * NOTE: the "hundreds" rounding unit interprets the spec — adjust here if the
 * business formula differs.
 */
@Injectable()
export class ForecastCalculatorService {
  constructor(private readonly configRepo: ForecastConfigRepository) {}

  calculate(config: ForecastConfig): ForecastResult {
    const parsed = ForecastConfigSchema.parse(config);

    const collected = parsed.divisions.map((division) => {
      const top1to4Teams = Math.min(division.teamCount, 4);
      const top5to8Teams = Math.min(Math.max(division.teamCount - 4, 0), 4);
      const top9PlusTeams = Math.max(division.teamCount - 8, 0);

      return (
        PLAYERS_PER_TEAM *
        (top1to4Teams * parsed.fees.top1_4 +
          top5to8Teams * parsed.fees.top5_8 +
          top9PlusTeams * parsed.fees.top8plus)
      );
    });

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
    const projectedProfit =
      totalCollected * (1 - parsed.prizePoolPercent / 100);
    const projectedExpenses = parsed.divisions.reduce(
      (division, c) => division + c.projectContribution,
      0,
    );

    return {
      divisions,
      totalCollected,
      totalPrizePool,
      projectedExpenses,
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
