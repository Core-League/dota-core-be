import { Module } from '@nestjs/common';
import { IngestionModule } from '../../use-cases/ingestion/ingestion.module';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [IngestionModule],
  controllers: [WebhookController],
})
export class WebhookControllerModule {}
