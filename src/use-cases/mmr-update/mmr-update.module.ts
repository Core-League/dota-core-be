import { Module } from '@nestjs/common';
import { ImageStorageConnectorModule } from '../../connectors/image-storage/image-storage-connector.module';
import { AssetModule } from '../asset/asset.module';
import { MmrUpdateService } from './mmr-update.service';

@Module({
  imports: [ImageStorageConnectorModule, AssetModule],
  providers: [MmrUpdateService],
  exports: [MmrUpdateService],
})
export class MmrUpdateModule {}
