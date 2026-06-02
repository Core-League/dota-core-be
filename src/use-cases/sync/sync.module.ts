import { Module } from '@nestjs/common';
import { MonobankModule } from '../../connectors/monobank/monobank.module';
import { ClassificationModule } from '../classification/classification.module';
import { SyncService } from './sync.service';

@Module({
  imports: [MonobankModule.register(), ClassificationModule],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
