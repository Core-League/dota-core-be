import { Module } from '@nestjs/common';
import { WayForPayService } from './wayforpay.service';

/** Provides {@link WayForPayService}; credentials are read from the env per call. */
@Module({
  providers: [WayForPayService],
  exports: [WayForPayService],
})
export class WayForPayModule {}
