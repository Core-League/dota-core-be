import { Injectable } from '@nestjs/common';
import { OperationGroupRepository } from '../../repos/operation-group.repository';
import { OperationRepository } from '../../repos/operation.repository';
import type { Operation } from '../../types/entities/finance/operation';
import type { OperationGroup } from '../../types/entities/finance/operation-group';
import { OperationGroupKind } from '../../types/enums/finance/OperationGroupKind';
import { OperationType } from '../../types/enums/finance/OperationType';
import { AssetService } from '../asset/asset.service';
import { TeamService } from '../team/team.service';
import { normalizeComment } from '../shared/normalize-comment';

/**
 * Collapses prize operations that share a normalized comment into one
 * {@link OperationGroup}, attaches the resolved team (name + avatar), and sums
 * the members' signed amounts. Re-runnable: it rebuilds all PRIZE groups from
 * the current operations.
 */
@Injectable()
export class PrizeGroupingService {
  constructor(
    private readonly operationRepo: OperationRepository,
    private readonly groupRepo: OperationGroupRepository,
    private readonly teamService: TeamService,
    private readonly assetService: AssetService,
  ) {}

  /** Rebuild every PRIZE group from the current set of prize operations. */
  async rebuild(): Promise<OperationGroup[]> {
    const operations = await this.operationRepo.list();
    const prizeOps = operations.filter((op) => op.type === OperationType.Prize);

    // Dropping the old groups also clears members' groupId (FK ON DELETE SET NULL).
    await this.groupRepo.deleteAllPrizeGroups();

    const byKey = new Map<string, Operation[]>();
    for (const op of prizeOps) {
      const key = normalizeComment(op.comment ?? op.title);
      const bucket = byKey.get(key) ?? [];
      bucket.push(op);
      byKey.set(key, bucket);
    }

    const groups: OperationGroup[] = [];
    for (const [key, members] of byKey) {
      const team = await this.teamService.resolveByComment(members[0].comment);
      const iconAssetId =
        team?.avatarRef != null
          ? (
              await this.assetService.getOrCreateExternal(
                team.avatarRef,
                team.name,
              )
            ).id
          : null;
      const aggregatedAmount = members.reduce((sum, op) => sum + op.amount, 0);
      const group = await this.groupRepo.upsertByGroupKey({
        kind: OperationGroupKind.Prize,
        title: team?.name ?? members[0].title,
        iconAssetId,
        aggregatedAmount,
        groupKey: key,
      });
      for (const op of members) {
        await this.operationRepo.setGroup(op.id, group.id);
      }
      groups.push({ ...group, operationIds: members.map((op) => op.id) });
    }
    return groups;
  }
}
