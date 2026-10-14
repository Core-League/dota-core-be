import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicPricingDto } from './dto/public-pricing.dto';
import { PublicPricingService } from './public-pricing.service';

/** No guard on purpose: the price list is a public legal page, read without login. */
@ApiTags('public')
@Controller('public')
export class PublicPricingController {
  constructor(private readonly pricing: PublicPricingService) {}

  @Get('pricing')
  @ApiOperation({
    summary: 'Public price list (no auth)',
    description:
      'VIP price and discounts, support payment bounds and the entry fees of paid tournaments whose ' +
      'registration is open or that have not started. Computed by the same helpers the checkout ' +
      'charges with; `legalVersion` is the version payment intents must agree to.',
  })
  @ApiOkResponse({ type: PublicPricingDto })
  getPricing(): Promise<PublicPricingDto> {
    return this.pricing.getPricing();
  }
}
