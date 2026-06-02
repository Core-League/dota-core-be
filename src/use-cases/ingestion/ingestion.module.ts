import { Module } from '@nestjs/common';
import { MonobankModule } from '../../connectors/monobank/monobank.module';
import { ClassificationModule } from '../classification/classification.module';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [MonobankModule.register(), ClassificationModule],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
