import { Injectable } from '@nestjs/common';
import { OperationGroupRepository } from '../../repos/operation-group.repository';
import {
  OperationRepository,
  type OperationListFilter,
} from '../../repos/operation.repository';
import type { Operation } from '../../types/entities/finance/operation';
import type { OperationGroup } from '../../types/entities/finance/operation-group';
import {
  FeedItemKind,
  FeedItemSign,
  type FeedItem,
  type FeedView,
} from '../../types/entities/finance/feed';
import { AssetService } from '../asset/asset.service';
import { ForecastCalculatorService } from '../forecast/forecast-calculator.service';
import { PrizeGroupingService } from '../prize-grouping/prize-grouping.service';

const sign = (amount: number): FeedItemSign =>
  amount < 0 ? FeedItemSign.Negative : FeedItemSign.Positive;

/**
 * The main feed. Returns operations signed, colored, and collapsed into their
 * groups; with `includeForecast`, prepends two **virtual** rows (projected
 * expenses `−`, projected profit `+`) taken from the active forecast — these are
 * never persisted. Prize groups are rebuilt first so the feed always reflects
 * current sponsors/teams (deterministic).
 */
@Injectable()
export class OperationService {
  constructor(
    private readonly operationRepo: OperationRepository,
    private readonly groupRepo: OperationGroupRepository,
    private readonly prizeGroupingService: PrizeGroupingService,
    private readonly forecast: ForecastCalculatorService,
    private readonly assetService: AssetService,
  ) {}

  async listFeed(
    filter: OperationListFilter = {},
    includeForecast = false,
  ): Promise<FeedView> {
    await this.prizeGroupingService.rebuild();

    const operations = await this.operationRepo.list(filter);
    const groups = await this.groupRepo.findAll();
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const iconUrlById = await this.assetService.resolveUrlMap();

    const items: FeedItem[] = [];
    const seenGroups = new Set<string>();
    for (const op of operations) {
      if (op.groupId) {
        if (seenGroups.has(op.groupId)) continue;
        const group = groupById.get(op.groupId);
        if (group) {
          seenGroups.add(op.groupId);
          items.push(this.groupToItem(group, op.time, iconUrlById));
          continue;
        }
      }
      items.push(this.operationToItem(op, iconUrlById));
    }

    const includesForecast = includeForecast
      ? await this.prependForecast(items)
      : false;

    return { items, includesForecast };
  }

  private operationToItem(
    op: Operation,
    iconUrlById: Map<string, string>,
  ): FeedItem {
    return {
      kind: FeedItemKind.Operation,
      id: op.id,
      amount: op.amount,
      sign: sign(op.amount),
      time: op.time,
      title: op.title,
      iconUrl: this.resolveIcon(op.iconAssetId, iconUrlById),
      operationIds: [],
      virtual: false,
    };
  }

  private groupToItem(
    group: OperationGroup,
    time: Date,
    iconUrlById: Map<string, string>,
  ): FeedItem {
    return {
      kind: FeedItemKind.Group,
      id: group.id,
      amount: group.aggregatedAmount,
      sign: sign(group.aggregatedAmount),
      time,
      title: group.title,
      iconUrl: this.resolveIcon(group.iconAssetId, iconUrlById),
      operationIds: group.operationIds,
      virtual: false,
    };
  }

  /** Resolve the icon asset to its URL (every icon is now a managed asset). */
  private resolveIcon(
    iconAssetId: string | null,
    iconUrlById: Map<string, string>,
  ): string | null {
    if (!iconAssetId) return null;
    return iconUrlById.get(iconAssetId) ?? null;
  }

  /** Prepend the two virtual forecast rows; returns whether any were added. */
  private async prependForecast(items: FeedItem[]): Promise<boolean> {
    const active = await this.forecast.getActive();
    if (!active) return false;
    const { projectedExpenses, projectedProfit } = active.result;
    const forecastRows: FeedItem[] = [
      {
        kind: FeedItemKind.Forecast,
        id: 'forecast-expenses',
        amount: -projectedExpenses,
        sign: FeedItemSign.Negative,
        time: null,
        title: 'Прогнозовані витрати',
        iconUrl: null,
        operationIds: [],
        virtual: true,
      },
      {
        kind: FeedItemKind.Forecast,
        id: 'forecast-profit',
        amount: projectedProfit,
        sign: FeedItemSign.Positive,
        time: null,
        title: 'Прогнозований прибуток',
        iconUrl: null,
        operationIds: [],
        virtual: true,
      },
    ];
    items.unshift(...forecastRows);
    return true;
  }
}
