import { Injectable } from '@nestjs/common';
import { TeamRepository } from '../../repos/team.repository';
import type { Team } from '../../types/entities/finance/team';
import { parsePrizeName } from '../shared/normalize-comment';

/**
 * Resolves a prize-recipient team from a transaction comment. The team data
 * lives in our DB (the v1 `team` table) — there is no external API call.
 */
@Injectable()
export class TeamService {
  constructor(private readonly teamRepo: TeamRepository) {}

  /**
   * Parse `"Подарок <name>"` and resolve the team by name. Returns `null` when
   * the comment is not a prize comment or no matching team exists.
   */
  async resolveByComment(
    comment: string | null | undefined,
  ): Promise<Team | null> {
    const name = parsePrizeName(comment);
    if (!name) return null;
    return this.teamRepo.findByName(name);
  }
}
