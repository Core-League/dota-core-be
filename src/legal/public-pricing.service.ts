import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, MoreThan, Not } from 'typeorm';
import {
  MAX_DONATION_KOPECKS,
  MIN_DONATION_KOPECKS,
} from '../tournaments/dto/create-tournament-donation.dto';
import { entryFeePerPlayer } from '../tournaments/tournament-team-payment.util';
import {
  isRegistrationOpen,
  registrationClosesAt,
  tournamentPlayStartsAt,
} from '../tournaments/tournament-registration.util';
import { Tournament } from '../tournaments/tournaments.entity';
import {
  TournamentStatus,
  isJoinableStatus,
} from '../tournaments/tournaments.model';
import {
  VIP_PERIOD_MONTHS,
  VIP_SWITCH_DISCOUNT_PERCENT,
  VIP_TOURNAMENT_DISCOUNT_PERCENT,
} from '../vip/vip.constants';
import { vipEntryFee, vipMonthlyPrice } from '../vip/vip.utils';
import { LEGAL_VERSION, PRICING_CURRENCY } from './legal.constants';
import {
  PublicPricingDto,
  PublicTournamentPricingDto,
} from './dto/public-pricing.dto';

/**
 * The public price list (`GET /public/pricing`): read by the `/prices` legal
 * page and by the checkout UI. Every number comes from the helpers the
 * checkout itself charges with (`vipMonthlyPrice`, `vipEntryFee`, the support
 * bounds of the donation DTO), never from a copy.
 */
@Injectable()
export class PublicPricingService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getPricing(now: Date = new Date()): Promise<PublicPricingDto> {
    const candidates = await this.dataSource.getRepository(Tournament).find({
      where: {
        entryFee: MoreThan(0),
        tournamentStatus: Not(TournamentStatus.COMPLETED),
      },
      order: { tournamentStartsAt: 'ASC' },
    });
    return {
      currency: PRICING_CURRENCY,
      legalVersion: LEGAL_VERSION,
      vip: {
        priceKopecks: vipMonthlyPrice(),
        periodMonths: VIP_PERIOD_MONTHS,
        switchDiscountPercent: VIP_SWITCH_DISCOUNT_PERCENT,
        tournamentDiscountPercent: VIP_TOURNAMENT_DISCOUNT_PERCENT,
      },
      support: {
        minKopecks: MIN_DONATION_KOPECKS,
        maxKopecks: MAX_DONATION_KOPECKS,
      },
      tournaments: candidates
        .filter((t) => isListed(t, now))
        .map((t) => toTournamentPricing(t)),
    };
  }
}

/** Registration open right now, or play has not begun yet. */
function isListed(tournament: Tournament, now: Date): boolean {
  if (
    isJoinableStatus(tournament.tournamentStatus) &&
    isRegistrationOpen(tournament, now)
  ) {
    return true;
  }
  const startsAt = tournamentPlayStartsAt(tournament);
  return !!startsAt && startsAt.getTime() > now.getTime();
}

function toTournamentPricing(
  tournament: Tournament,
): PublicTournamentPricingDto {
  const entryFee = tournament.entryFee ?? 0;
  return {
    id: tournament.id,
    name: tournament.name,
    entryFeeKopecks: entryFee,
    perPlayerKopecks: entryFeePerPlayer(entryFee),
    vipEntryFeeKopecks: vipEntryFee(entryFee, true),
    prizePool: tournament.prizePool ?? null,
    registrationEndsAt: iso(registrationClosesAt(tournament)),
    startsAt: iso(tournamentPlayStartsAt(tournament)),
  };
}

function iso(at: Date | null): string | null {
  return at ? at.toISOString() : null;
}
