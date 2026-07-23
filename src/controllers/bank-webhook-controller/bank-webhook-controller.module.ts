import { Module } from '@nestjs/common';
import { MonobankModule } from '../../connectors/monobank/monobank.module';
import { BankWebhookController } from './bank-webhook.controller';

@Module({
  imports: [MonobankModule.register()],
  controllers: [BankWebhookController],
})
export class BankWebhookControllerModule {}
