import type { Player } from '../players/player.entity';
import {
  VIP_LIFETIME_UNTIL,
  VIP_TOURNAMENT_DISCOUNT_PERCENT,
} from './vip.constants';

/** VIP while `vipUntil` lies in the future. Payments and admin grants share the column. */
export function isVipActive(
  player: Pick<Player, 'vipUntil'> | null | undefined,
  now: Date = new Date(),
): boolean {
  const until = player?.vipUntil;
  return !!until && until.getTime() > now.getTime();
}

/** VIP fields of every public player payload; the frame colour only while VIP lasts. */
export function toVipPublicFields(
  player: Pick<Player, 'vipUntil' | 'vipFrameColor'>,
): { isVip: boolean; vipUntil: Date | null; vipFrameColor: string | null } {
  const isVip = isVipActive(player);
  return {
    isVip,
    vipUntil: isVip ? player.vipUntil : null,
    vipFrameColor: isVip ? (player.vipFrameColor ?? null) : null,
  };
}

/** `anchor` plus `months` calendar months. */
export function addMonths(anchor: Date, months: number): Date {
  const next = new Date(anchor.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

/** `anchor` plus `hours`. */
export function addHours(anchor: Date, hours: number): Date {
  return new Date(anchor.getTime() + hours * 3600 * 1000);
}

/** Entry fee (kopecks) a captain owes: VIP pays {@link VIP_TOURNAMENT_DISCOUNT_PERCENT}% less. */
export function vipEntryFee(entryFee: number, isVip: boolean): number {
  if (!isVip || entryFee <= 0) return entryFee;
  return Math.round((entryFee * (100 - VIP_TOURNAMENT_DISCOUNT_PERCENT)) / 100);
}

/** Lifetime VIP: `vipUntil` set to {@link VIP_LIFETIME_UNTIL} by an admin. */
export function isVipLifetime(
  player: Pick<Player, 'vipUntil'> | null | undefined,
): boolean {
  const until = player?.vipUntil;
  return !!until && until.getTime() >= VIP_LIFETIME_UNTIL.getTime();
}
