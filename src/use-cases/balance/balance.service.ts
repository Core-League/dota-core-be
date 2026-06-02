import { Injectable } from '@nestjs/common';
import { ConfigConnectorService } from '../../connectors/config/config-connector.service';
import { TransactionRepository } from '../../repos/transaction.repository';
import type { Balance } from '../../types/entities/finance/balance';
import { ForecastCalculatorService } from '../forecast/forecast-calculator.service';

/**
 * Computes the account balance. The authoritative source is the mirrored
 * account balance (from `client-info`); if the account has not been synced yet,
 * it falls back to the latest transaction's running `balance`. With
 * `includeForecast`, it adds the **same** forecast delta the feed shows
 * (projected profit − projected expenses) so the two views stay consistent.
 */
@Injectable()
export class BalanceService {
  constructor(
    private readonly transactionRepo: TransactionRepository,
    private readonly forecast: ForecastCalculatorService,
    private readonly config: ConfigConnectorService,
  ) {}

  async getBalance(includeForecast = false): Promise<Balance> {
    const actual = await this.resolveActualBalance();
    const forecastDelta = includeForecast
      ? await this.resolveForecastDelta()
      : 0;

    return {
      actual,
      forecast: forecastDelta,
      total: actual + forecastDelta,
      includesForecast: includeForecast && forecastDelta !== 0,
    };
  }

  private async resolveActualBalance(): Promise<number> {
    const accountId = this.config.getEnvConfig().MONOBANK_ACCOUNT_ID;
    if (accountId) {
      const txs = await this.transactionRepo.findByAccount(accountId);
      if (txs.length > 0) {
        return txs[txs.length - 1].balance;
      }
    }

    return 0;
  }

  private async resolveForecastDelta(): Promise<number> {
    const active = await this.forecast.getActive();
    if (!active) return 0;
    return active.result.projectedProfit - active.result.projectedExpenses;
  }
}
