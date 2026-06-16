import { Injectable } from '@nestjs/common';
import { CustomCategoryRepository } from '../../repos/custom-category.repository';
import { OperationGroupRepository } from '../../repos/operation-group.repository';
import {
  OperationRepository,
  type OperationListFilter,
} from '../../repos/operation.repository';
import type { Operation } from '../../types/entities/finance/operation';
import type { OperationGroup } from '../../types/entities/finance/operation-group';
import {
  FeedGroupKind,
  FeedItemKind,
  FeedItemSign,
  type FeedCategoryRef,
  type FeedItem,
  type FeedView,
} from '../../types/entities/finance/feed';
import { OperationGroupKind } from '../../types/enums/finance/OperationGroupKind';
import { AssetService } from '../asset/asset.service';
import { ForecastCalculatorService } from '../forecast/forecast-calculator.service';
import { OTHER_GIFTS_GROUP_KEY } from '../shared/group-keys';

const sign = (amount: number): FeedItemSign =>
  amount < 0 ? FeedItemSign.Negative : FeedItemSign.Positive;

/** Map a persisted group's kind/key to the feed's discriminating groupKind. */
const feedGroupKind = (group: OperationGroup): FeedGroupKind => {
  switch (group.kind) {
    case OperationGroupKind.Sponsor:
      return FeedGroupKind.Sponsor;
    case OperationGroupKind.Custom:
      return FeedGroupKind.Manual;
    case OperationGroupKind.Prize:
      return group.groupKey === OTHER_GIFTS_GROUP_KEY
        ? FeedGroupKind.OtherGifts
        : FeedGroupKind.TeamGift;
  }
};

/**
 * Builds the main feed for a range. Operations are signed, carry their category,
 * and collapse into group rows when their `groupId` points to a persisted
 * `operation_group`; all groups render the same shape, with `groupKind` /
 * `groupKey` distinguishing them and amounts summed live over the in-range
 * members. With `includeForecast`, prepends two virtual (never persisted) rows:
 * projected expenses (`−`) and profit (`+`) from the active forecast.
 */
@Injectable()
export class OperationService {
  constructor(
    private readonly operationRepo: OperationRepository,
    private readonly groupRepo: OperationGroupRepository,
    private readonly categoryRepo: CustomCategoryRepository,
    private readonly forecast: ForecastCalculatorService,
    private readonly assetService: AssetService,
  ) { }

  async listFeed(
    filter: OperationListFilter = {},
    includeForecast = false,
  ): Promise<FeedView> {
    const operations = await this.operationRepo.list(filter);
    const iconUrlById = await this.assetService.resolveUrlMap();
    const categoryRefById = await this.buildCategoryRefs(iconUrlById);

    // Ops without a (known) groupId become standalone items.
    const allGroups = await this.groupRepo.findAll();
    const groupById = new Map(allGroups.map((g) => [g.id, g]));

    const groupBuckets = new Map<string, Operation[]>();
    const standalone: Operation[] = [];

    for (const op of operations) {
      if (op.groupId && groupById.has(op.groupId)) {
        const bucket = groupBuckets.get(op.groupId) ?? [];
        bucket.push(op);
        groupBuckets.set(op.groupId, bucket);
      } else {
        standalone.push(op);
      }
    }

    const toLeaf = (op: Operation): FeedItem =>
      this.operationToItem(op, iconUrlById, categoryRefById);

    const items: FeedItem[] = [
      ...standalone.map(toLeaf),
      ...[...groupBuckets].map(([groupId, members]) =>
        this.groupToItem(groupById.get(groupId)!, members, iconUrlById, toLeaf),
      ),
    ];

    // Newest first; group rows sort by their most recent member.
    const ms = (t: string | null): number => (t ? new Date(t).getTime() : 0);
    items.sort((a, b) => ms(b.time) - ms(a.time));

    const includesForecast = includeForecast
      ? await this.prependForecast(items)
      : false;

    return { items, includesForecast };
  }

  /** Map every category id to its display ref (label + resolved icon URL). */
  private async buildCategoryRefs(
    iconUrlById: Map<string, string>,
  ): Promise<Map<string, FeedCategoryRef>> {
    const categories = await this.categoryRepo.findAll();
    return new Map(
      categories.map((c) => [
        c.id,
        {
          id: c.id,
          label: c.label,
          iconUrl: this.resolveIcon(c.iconAssetId, iconUrlById),
        },
      ]),
    );
  }

  private operationToItem(
    op: Operation,
    iconUrlById: Map<string, string>,
    categoryRefById: Map<string, FeedCategoryRef>,
  ): FeedItem {
    return {
      kind: FeedItemKind.Operation,
      id: op.id,
      amount: op.amount,
      sign: sign(op.amount),
      time: op.time.toISOString(),
      title: op.title,
      iconUrl: this.resolveIcon(op.iconAssetId, iconUrlById),
      operationIds: [],
      groupKind: null,
      groupKey: null,
      count: 0,
      category: op.categoryId
        ? (categoryRefById.get(op.categoryId) ?? null)
        : null,
      virtual: false,
      isHidden: op.isHidden,
      children: [],
    };
  }

  /** A persisted group row (PRIZE or CUSTOM), aggregated over the range. */
  private groupToItem(
    group: OperationGroup,
    members: Operation[],
    iconUrlById: Map<string, string>,
    toLeaf: (op: Operation) => FeedItem,
  ): FeedItem {
    const amount = sumAmount(members);
    return {
      kind: FeedItemKind.Group,
      id: group.id,
      amount,
      sign: sign(amount),
      time: latestTime(members)?.toISOString() ?? null,
      title: group.title,
      iconUrl: this.resolveIcon(group.iconAssetId, iconUrlById),
      operationIds: members.map((op) => op.id),
      groupKind: feedGroupKind(group),
      groupKey: group.groupKey,
      count: members.length,
      category: null,
      virtual: false,
      isHidden: false,
      children: members.map(toLeaf),
    };
  }

  /** Resolve the icon asset to its URL (every icon is a managed asset). */
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
      this.forecastRow(
        'forecast-profit',
        projectedProfit,
        'Прогнозований прибуток',
      ),
      this.forecastRow(
        'forecast-expenses',
        -projectedExpenses,
        'Прогнозовані витрати',
      ),
    ];
    items.unshift(...forecastRows);
    return true;
  }

  private forecastRow(id: string, amount: number, title: string): FeedItem {
    return {
      kind: FeedItemKind.Forecast,
      id,
      amount,
      sign: sign(amount),
      time: null,
      title,
      iconUrl: null,
      operationIds: [],
      groupKind: null,
      groupKey: null,
      count: 0,
      category: null,
      virtual: true,
      isHidden: false,
      children: [],
    };
  }
}

function sumAmount(members: Operation[]): number {
  return members.reduce((sum, op) => sum + op.amount, 0);
}

function latestTime(members: Operation[]): Date | null {
  return members.reduce<Date | null>(
    (latest, op) => (!latest || op.time > latest ? op.time : latest),
    null,
  );
}
