import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tournament } from '../tournaments/tournaments.entity';
import { PaymentConsent } from './payment-consent.entity';
import { PublicPricingController } from './public-pricing.controller';
import { PublicPricingService } from './public-pricing.service';

/**
 * Public legal data (api-v1): the price list the `/prices` page and the
 * checkout read, and the legal-documents version payments are consented to.
 * Registers `payment_consent`; the payment services append to it through
 * their own transaction manager (`recordPaymentConsent`).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tournament, PaymentConsent])],
  controllers: [PublicPricingController],
  providers: [PublicPricingService],
})
export class LegalModule {}
