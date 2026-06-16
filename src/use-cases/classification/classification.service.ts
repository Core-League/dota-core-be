import { Injectable } from '@nestjs/common';
import { CustomCategoryRepository } from '../../repos/custom-category.repository';
import { OperationGroupRepository } from '../../repos/operation-group.repository';
import { OperationRepository } from '../../repos/operation.repository';
import { TransactionRepository } from '../../repos/transaction.repository';
import type { CustomCategory } from '../../types/entities/finance/custom-category';
import type {
  Operation,
  OperationDraft,
  OperationUpsert,
} from '../../types/entities/finance/operation';
import type { OperationGroup } from '../../types/entities/finance/operation-group';
import type {
  Sponsor,
  SponsorWithAttachment,
} from '../../types/entities/finance/sponsor';
import type { StoredTransaction } from '../../types/entities/finance/transaction';
import { OperationGroupKind } from '../../types/enums/finance/OperationGroupKind';
import { OperationType } from '../../types/enums/finance/OperationType';
import { SponsorKind } from '../../types/enums/finance/SponsorKind';
import { AssetService } from '../asset/asset.service';
import { SponsorService } from '../sponsor/sponsor.service';
import type { Team } from '../../types/entities/finance/team';
import { TeamService } from '../team/team.service';
import { parsePrizeName } from '../shared/normalize-comment';
import {
  OTHER_GIFTS_GROUP_KEY,
  sponsorGroupKey,
  teamGroupKey,
} from '../shared/group-keys';
import { StorageType } from 'src/types/enums/finance/StorageType';
import { AssetType } from 'src/types/enums/finance/AssetType';

/** Per-run catalogs (loaded once) + caches keyed by distinct dependency. */
type ClassifyContext = {
  sponsors: SponsorWithAttachment[];
  categories: CustomCategory[];
  teams: Team[];
  /** Upserted group ids keyed by `groupKey`. */
  groupIds: Map<string, string>;
  /** Created avatar asset ids keyed by `team.id`. */
  teamAssetIds: Map<string, string | null>;
};

/** What a single transaction classifies to, decided from the cached catalogs. */
type Decision =
  | { kind: 'sponsor'; sponsor: Sponsor }
  | { kind: 'prizeTeam'; team: Team }
  | { kind: 'prizeOther'; title: string }
  | { kind: 'custom'; title: string };

/**
 * Turns a {@link StoredTransaction} into a typed {@link Operation} via deterministic,
 * priority-ordered rules (so {@link reclassifyAll} can re-run safely):
 * sponsor (DueloGg/Betking) → PRIZE (`"Подарунок для <team>"`, upserts an
 * `operation_group` keyed `team:<id>` or the `gift:other` catch-all) → CUSTOM.
 * A category is auto-assigned from `matchers` when none is set manually. Operations
 * are upserted by `transactionId`, so re-classifying overwrites rather than duplicates.
 */
@Injectable()
export class ClassificationService {
  constructor(
    private readonly sponsorService: SponsorService,
    private readonly teamService: TeamService,
    private readonly assetService: AssetService,
    private readonly operationRepo: OperationRepository,
    private readonly transactionRepo: TransactionRepository,
    private readonly categoryRepo: CustomCategoryRepository,
    private readonly groupRepo: OperationGroupRepository,
  ) {}

  async classify(tx: StoredTransaction): Promise<Operation> {
    const ctx = await this.createContext();
    const drafts = await this.buildDrafts([tx], ctx);
    const [operation] = await this.persist(drafts);
    return operation;
  }

  /**
   * Classify a batch of freshly-ingested transactions. Only the given ones are
   * touched, so a sync never overrides operations from other transactions.
   */
  async classifyNew(transactions: StoredTransaction[]): Promise<Operation[]> {
    if (transactions.length === 0) return [];
    const ctx = await this.createContext();
    const drafts = await this.buildDrafts(transactions, ctx);
    return this.persist(drafts);
  }

  async reclassifyAll(): Promise<number> {
    const [transactions, ctx] = await Promise.all([
      this.transactionRepo.findAll(),
      this.createContext(),
    ]);
    const drafts = await this.buildDrafts(transactions, ctx);
    const saved = await this.persist(drafts);
    return saved.length;
  }

  /**
   * Load existing rows in one query, apply the preserve-rules, then bulk-write
   * the merged batch.
   */
  private async persist(drafts: OperationDraft[]): Promise<Operation[]> {
    const txIds = drafts
      .map((d) => d.transactionId)
      .filter((id): id is string => id !== null);
    const existing = await this.operationRepo.findByTransactionIds(txIds);
    const existingByTx = new Map(existing.map((e) => [e.transactionId, e]));

    const rows = drafts.map((draft) =>
      this.mergeWithExisting(
        draft,
        draft.transactionId !== null
          ? existingByTx.get(draft.transactionId)
          : undefined,
      ),
    );
    return this.operationRepo.saveMany(rows);
  }

  /**
   * Merge a draft with its stored row. Draft wins (it's deterministic) except for
   * user overrides: `groupId` keeps the existing assignment unless the draft set
   * one (PRIZE), and a manual category stays locked against the auto-matched value.
   */
  private mergeWithExisting(
    draft: OperationDraft,
    existing: Operation | undefined,
  ): OperationUpsert {
    if (!existing) return draft;
    return {
      ...draft,
      id: existing.id,
      groupId: draft.groupId ?? existing.groupId,
      categoryId: existing.categoryManual
        ? existing.categoryId
        : draft.categoryId,
      categoryManual: existing.categoryManual,
    };
  }

  /** Preload the read-only catalogs once and init empty dependency caches. */
  private async createContext(): Promise<ClassifyContext> {
    const [sponsors, categories, teams] = await Promise.all([
      this.sponsorService.catalog(),
      this.categoryRepo.findAll(),
      this.teamService.catalog(),
    ]);
    return {
      sponsors,
      categories,
      teams,
      groupIds: new Map(),
      teamAssetIds: new Map(),
    };
  }

  /**
   * Resolve every transaction to an {@link OperationDraft}. Decisions are made in
   * memory from `ctx`; only the dependent writes (avatar assets → groups) hit the
   * DB, each as one bulk call — no per-transaction query.
   */
  private async buildDrafts(
    transactions: StoredTransaction[],
    ctx: ClassifyContext,
  ): Promise<OperationDraft[]> {
    const decisions = transactions.map((tx) => this.decide(tx, ctx));
    await this.resolveTeamAssets(decisions, ctx);
    await this.resolveGroups(decisions, ctx);
    return transactions.map((tx, i) => this.buildDraft(tx, decisions[i], ctx));
  }

  /** Decide a transaction's branch from the cached catalogs (sync, no DB). */
  private decide(tx: StoredTransaction, ctx: ClassifyContext): Decision {
    const sponsor = this.sponsorService.matchIn(tx, ctx.sponsors);
    if (sponsor) return { kind: 'sponsor', sponsor };

    const prizeName = parsePrizeName(tx.comment);
    if (prizeName) {
      const team = this.teamService.matchIn(tx.comment, ctx.teams);
      return team
        ? { kind: 'prizeTeam', team }
        : { kind: 'prizeOther', title: prizeName };
    }

    return { kind: 'custom', title: tx.comment?.trim() || tx.description };
  }

  /** Build the final draft for a decided transaction — pure, no DB access. */
  private buildDraft(
    tx: StoredTransaction,
    decision: Decision,
    ctx: ClassifyContext,
  ): OperationDraft {
    const base = {
      transactionId: tx.id,
      amount: tx.amount,
      time: tx.time,
      groupId: null as string | null,
      comment: tx.comment ?? null,
      // Auto-assigned here; a manual assignment is preserved by the repo upsert.
      categoryId: this.matchCategoryId(tx, ctx.categories),
      categoryManual: false,
      isHidden: false,
      raw: tx as unknown as Record<string, unknown>,
    };

    switch (decision.kind) {
      case 'sponsor': {
        const { sponsor } = decision;
        return {
          ...base,
          groupId: ctx.groupIds.get(sponsorGroupKey(sponsor.id)) ?? null,
          type:
            sponsor.kind === SponsorKind.DueloGg
              ? OperationType.DueloGg
              : OperationType.Betking,
          title: sponsor.name,
          iconAssetId: sponsor.logoAssetId,
        };
      }
      case 'prizeTeam': {
        const { team } = decision;
        return {
          ...base,
          groupId: ctx.groupIds.get(teamGroupKey(team.id)) ?? null,
          type: OperationType.Prize,
          title: team.name,
          iconAssetId: ctx.teamAssetIds.get(team.id) ?? null,
        };
      }
      case 'prizeOther':
        return {
          ...base,
          groupId: ctx.groupIds.get(OTHER_GIFTS_GROUP_KEY) ?? null,
          type: OperationType.Prize,
          title: decision.title,
          iconAssetId: null,
        };
      case 'custom':
        return {
          ...base,
          type: OperationType.Custom,
          title: decision.title,
          iconAssetId: null,
        };
    }
  }

  /**
   * Bulk-upsert avatar assets for the distinct prize-teams that have one and cache
   * the asset id per `team.id`. Reuses existing rows so a re-run doesn't duplicate.
   */
  private async resolveTeamAssets(
    decisions: Decision[],
    ctx: ClassifyContext,
  ): Promise<void> {
    const teamsById = new Map<string, Team>();
    for (const d of decisions) {
      if (d.kind === 'prizeTeam' && d.team.avatarRef) {
        teamsById.set(d.team.id, d.team);
      }
    }
    const teams = [...teamsById.values()];
    if (teams.length === 0) return;

    const assets = await this.assetService.ensureManyByLocation(
      teams.map((team) => ({
        storageType: StorageType.Local,
        type: AssetType.Team,
        name: `Team ${team.name} avatar`,
        path: team.avatarRef as string,
      })),
    );
    teams.forEach((team, i) => ctx.teamAssetIds.set(team.id, assets[i].id));
  }

  /** Upsert all distinct groups in one bulk call and cache their ids by `groupKey`. */
  private async resolveGroups(
    decisions: Decision[],
    ctx: ClassifyContext,
  ): Promise<void> {
    const specs = new Map<
      string,
      Omit<OperationGroup, 'id' | 'operationIds'>
    >();
    for (const d of decisions) {
      if (d.kind === 'sponsor') {
        const groupKey = sponsorGroupKey(d.sponsor.id);
        specs.set(groupKey, {
          kind: OperationGroupKind.Sponsor,
          title: d.sponsor.name,
          iconAssetId: d.sponsor.logoAssetId,
          groupKey,
        });
      } else if (d.kind === 'prizeTeam') {
        const groupKey = teamGroupKey(d.team.id);
        specs.set(groupKey, {
          kind: OperationGroupKind.Prize,
          title: d.team.name,
          iconAssetId: ctx.teamAssetIds.get(d.team.id) ?? null,
          groupKey,
        });
      } else if (d.kind === 'prizeOther') {
        specs.set(OTHER_GIFTS_GROUP_KEY, {
          kind: OperationGroupKind.Prize,
          title: 'Other gifts',
          iconAssetId: null,
          groupKey: OTHER_GIFTS_GROUP_KEY,
        });
      }
    }
    if (specs.size === 0) return;

    const groups = await this.groupRepo.upsertManyByGroupKey([
      ...specs.values(),
    ]);
    for (const group of groups) ctx.groupIds.set(group.groupKey, group.id);
  }

  /**
   * First category whose `matchers` substring-hit the comment/description
   * (case-insensitive), or null. Only fills the initial (auto) assignment.
   */
  private matchCategoryId(
    tx: StoredTransaction,
    categories: CustomCategory[],
  ): string | null {
    const haystack = [tx.comment ?? '', tx.description].join(' ').toLowerCase();
    const hit = categories.find((c) =>
      c.matchers.some(
        (m) => m.length > 0 && haystack.includes(m.toLowerCase()),
      ),
    );
    return hit?.id ?? null;
  }
}
