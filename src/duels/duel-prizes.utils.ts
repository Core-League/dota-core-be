import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DuelTournamentPrize, DuelTournamentPrizeKind } from './duel.constants';
import type { DuelTournamentPrizeInputDto } from './dto/duel-tournament.dto';

/**
 * Validates prize places (tournaments and seasons) and brings them to the
 * stored shape: unique places, sorted, fields of the other kind dropped,
 * nobody awarded yet. VIP places are paid value, so a non-admin may neither
 * add nor change them — only keep the ones an admin set (`current`).
 */
export function normalizeDuelPrizes(
  input: DuelTournamentPrizeInputDto[],
  current: DuelTournamentPrize[],
  isAdmin: boolean,
): DuelTournamentPrize[] {
  const places = new Set<number>();
  const prizes = input.map((p): DuelTournamentPrize => {
    if (places.has(p.place)) {
      throw new BadRequestException({
        error: 'tournament_prize_place_duplicate',
        message: `Приз за ${p.place} місце вказано двічі`,
      });
    }
    places.add(p.place);
    const title = p.title?.trim() || null;
    if (p.kind === DuelTournamentPrizeKind.VIP) {
      return {
        place: p.place,
        kind: p.kind,
        vipMonths: p.vipMonths ?? null,
        title,
        imageUrl: null,
        linkUrl: null,
        awardedPlayerId: null,
      };
    }
    return {
      place: p.place,
      kind: p.kind,
      vipMonths: null,
      title,
      imageUrl: p.imageUrl?.trim() || null,
      linkUrl: p.linkUrl?.trim() || null,
      awardedPlayerId: null,
    };
  });
  prizes.sort((a, b) => a.place - b.place);

  if (!isAdmin) {
    const vipKey = (list: DuelTournamentPrize[]) =>
      list
        .filter((p) => p.kind === DuelTournamentPrizeKind.VIP)
        .map((p) => `${p.place}:${p.vipMonths}`)
        .sort()
        .join(',');
    if (vipKey(prizes) !== vipKey(current)) {
      throw new ForbiddenException({
        error: 'tournament_prize_vip_admin_only',
        message: 'VIP як приз може призначати лише адмін',
      });
    }
  }
  return prizes;
}
