import { Module } from '@nestjs/common';
import { SyncModule } from '../../use-cases/sync/sync.module';
import { SyncController } from './sync.controller';

@Module({
  imports: [SyncModule],
  controllers: [SyncController],
})
export class SyncControllerModule {}
