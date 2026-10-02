import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ChatEventsModule } from '../chat/chat-access.events';
import { MonobankAcquiringModule } from '../connectors/monobank-acquiring/monobank-acquiring.module';
import { Player } from '../players/player.entity';
import { VipAdminController, VipController } from './vip.controller';
import { VipPayment } from './vip-payment.entity';
import { VipRenewalScheduler } from './vip-renewal.scheduler';
import { VipSubscription } from './vip-subscription.entity';
import { VipService } from './vip.service';

/**
 * VIP status (api-v1). The Monobank webhook stays on the shared acquiring
 * receiver in the tournaments module, which hands VIP invoices to
 * {@link VipService.applyInvoiceCallback}.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Player, VipSubscription, VipPayment]),
    AuthModule,
    ChatEventsModule,
    MonobankAcquiringModule.register(),
  ],
  controllers: [VipController, VipAdminController],
  providers: [VipService, VipRenewalScheduler],
  exports: [VipService],
})
export class VipModule {}
