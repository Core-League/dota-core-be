import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ChatEventsModule } from '../chat/chat-access.events';
import { MonobankAcquiringModule } from '../connectors/monobank-acquiring/monobank-acquiring.module';
import { WayForPayModule } from '../connectors/wayforpay/wayforpay.module';
import { Player } from '../players/player.entity';
import { VipAdminController, VipController } from './vip.controller';
import { VipPayment } from './vip-payment.entity';
import { VipRenewalScheduler } from './vip-renewal.scheduler';
import { VipSubscription } from './vip-subscription.entity';
import { VipService } from './vip.service';

/**
 * VIP status (api-v1). The Monobank and WayForPay callbacks stay on the shared
 * receivers in the tournaments module, which hand VIP payments to
 * {@link VipService.applyInvoiceCallback} / {@link VipService.applyWayForPayCallback}.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Player, VipSubscription, VipPayment]),
    AuthModule,
    ChatEventsModule,
    MonobankAcquiringModule.register(),
    WayForPayModule,
  ],
  controllers: [VipController, VipAdminController],
  providers: [VipService, VipRenewalScheduler],
  exports: [VipService],
})
export class VipModule {}
