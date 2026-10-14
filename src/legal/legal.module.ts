import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tournament } from '../tournaments/tournaments.entity';
import { PublicPricingController } from './public-pricing.controller';
import { PublicPricingService } from './public-pricing.service';

/**
 * Public legal data (api-v1): the price list the `/prices` page and the
 * checkout read, and the legal-documents version payments are consented to.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tournament])],
  controllers: [PublicPricingController],
  providers: [PublicPricingService],
})
export class LegalModule {}
