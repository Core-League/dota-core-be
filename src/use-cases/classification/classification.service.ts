import { Injectable } from '@nestjs/common';
import { CustomCategoryRepository } from '../../repos/custom-category.repository';
import { OperationGroupRepository } from '../../repos/operation-group.repository';
import { OperationRepository } from '../../repos/operation.repository';
import { TransactionRepository } from '../../repos/transaction.repository';
import type {
  Operation,
  OperationDraft,
} from '../../types/entities/finance/operation';
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

/**
 * Turns a raw {@link StoredTransaction} into a typed {@link Operation}. Rules are
 * applied in priority order and the result is deterministic, so
 * {@link ClassificationService.reclassifyAll} can be re-run whenever sponsors or
 * teams change:
 *
 * 1. `DUELO_GG` — matched sponsor of kind Duelo GG
 * 2. `BETKING`  — matched sponsor of kind betking
 * 3. `PRIZE`    — comment is `"Подарунок для <team>"`. A persistent
 *    `operation_group` row is upserted and the operation's `groupId` set to it:
 *    `groupKey = team:<team.id>` when the team resolves, otherwise the single
 *    `gift:other` "Other gifts" catch-all group.
 * 4. `CUSTOM`   — everything else
 *
 * Independently, a category is auto-assigned from `matchers` when none is set
 * manually (see {@link matchCategoryId}).
 *
 * The derived operation is upserted by `transactionId`, so re-classifying
 * overwrites rather than duplicates.
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
    const operation = await this.buildOperation(tx);
    return this.operationRepo.upsertByTransactionId(operation);
  }

  async reclassifyAll(): Promise<number> {
    const transactions = await this.transactionRepo.findAll();
    for (const tx of transactions) {
      await this.classify(tx);
    }
    return transactions.length;
  }

  private async buildOperation(tx: StoredTransaction): Promise<OperationDraft> {
    const base = {
      transactionId: tx.id,
      amount: tx.amount,
      time: tx.time,
      groupId: null as string | null,
      comment: tx.comment ?? null,
      // Auto-assigned here; a manual assignment is preserved by the repo upsert.
      categoryId: await this.matchCategoryId(tx),
      categoryManual: false,
      raw: tx as unknown as Record<string, unknown>,
    };

    const sponsor = await this.sponsorService.match(tx);
    if (sponsor) {
      const group = await this.groupRepo.upsertByGroupKey({
        kind: OperationGroupKind.Sponsor,
        title: sponsor.name,
        iconAssetId: sponsor.logoAssetId,
        groupKey: sponsorGroupKey(sponsor.id),
      });
      return {
        ...base,
        groupId: group.id,
        type:
          sponsor.kind === SponsorKind.DueloGg
            ? OperationType.DueloGg
            : OperationType.Betking,
        title: sponsor.name,
        iconAssetId: sponsor.logoAssetId,
      };
    }

    const prizeName = parsePrizeName(tx.comment);

    if (prizeName) {
      const team = await this.teamService.resolveByComment(tx.comment);

      if (team) {
        // Persist (or refresh) the PRIZE group for this team and link the op.
        const iconAssetId = await this.teamAvatarAssetId(team);
        const group = await this.groupRepo.upsertByGroupKey({
          kind: OperationGroupKind.Prize,
          title: team.name,
          iconAssetId,
          groupKey: teamGroupKey(team.id),
        });
        return {
          ...base,
          groupId: group.id,
          type: OperationType.Prize,
          title: team.name,
          iconAssetId,
        };
      }

      // Team could not be resolved — collapse into the single "Other gifts" group.
      const group = await this.groupRepo.upsertByGroupKey({
        kind: OperationGroupKind.Prize,
        title: 'Other gifts',
        iconAssetId: null,
        groupKey: OTHER_GIFTS_GROUP_KEY,
      });
      return {
        ...base,
        groupId: group.id,
        type: OperationType.Prize,
        title: prizeName,
        iconAssetId: null,
      };
    }

    return {
      ...base,
      type: OperationType.Custom,
      title: tx.comment?.trim() || tx.description,
      iconAssetId: null,
    };
  }

  /**
   * First category whose `matchers` substring-hit the transaction's
   * comment/description (case-insensitive), or null. Mirrors
   * {@link SponsorService.match}; only fills the initial (auto) assignment.
   */
  private async matchCategoryId(tx: StoredTransaction): Promise<string | null> {
    const haystack = [tx.comment ?? '', tx.description].join(' ').toLowerCase();
    const categories = await this.categoryRepo.findAll();
    const hit = categories.find((c) =>
      c.matchers.some(
        (m) => m.length > 0 && haystack.includes(m.toLowerCase()),
      ),
    );
    return hit?.id ?? null;
  }

  /** Wrap a team's external avatar URL in an asset and return its id. */
  private async teamAvatarAssetId(team: Team | null): Promise<string | null> {
    if (!team?.avatarRef) return null;
    const asset = await this.assetService.getOrCreateExternal(
      team.avatarRef,
      team.name,
    );
    return asset.id;
  }
}
