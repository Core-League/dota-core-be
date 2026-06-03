import { Module } from '@nestjs/common';
import { AssetModule } from '../asset/asset.module';
import { CustomOperationService } from './custom-operation.service';

@Module({
  imports: [AssetModule],
  providers: [CustomOperationService],
  exports: [CustomOperationService],
})
export class CustomOperationModule {}
