import { Injectable } from '@nestjs/common';
import { OperationRepository } from '../../repos/operation.repository';
import { TransactionRepository } from '../../repos/transaction.repository';
import type {
  Operation,
  OperationDraft,
} from '../../types/entities/finance/operation';
import type { StoredTransaction } from '../../types/entities/finance/transaction';
import { OperationType } from '../../types/enums/finance/OperationType';
import { SponsorKind } from '../../types/enums/finance/SponsorKind';
import { AssetService } from '../asset/asset.service';
import { SponsorService } from '../sponsor/sponsor.service';
import type { Team } from '../../types/entities/finance/team';
import { TeamService } from '../team/team.service';
import { parsePrizeName } from '../shared/normalize-comment';

/**
 * Turns a raw {@link StoredTransaction} into a typed {@link Operation}. Rules are
 * applied in priority order and the result is deterministic, so
 * {@link ClassificationService.reclassifyAll} can be re-run whenever sponsors or
 * teams change:
 *
 * 1. `DUELO_GG` — matched sponsor of kind Duelo GG
 * 2. `BETKING`  — matched sponsor of kind betking
 * 3. `PRIZE`    — comment is `"Подарок <team>"`
 * 4. `CUSTOM`   — everything else
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
  ) { }

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
      groupId: null,
      comment: tx.comment ?? null,
      raw: tx as unknown as Record<string, unknown>,
    };

    const sponsor = await this.sponsorService.match(tx);
    if (sponsor) {
      return {
        ...base,
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
      return {
        ...base,
        type: OperationType.Prize,
        title: team?.name ?? prizeName,
        iconAssetId: await this.teamAvatarAssetId(team),
      };
    }

    return {
      ...base,
      type: OperationType.Custom,
      title: tx.comment?.trim() || tx.description,
      iconAssetId: null,
    };
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
