import { Module } from '@nestjs/common';
import { ImageStorageConnectorService } from './image-storage-connector.service';

/**
 * Provides {@link ImageStorageConnectorService}. Self-contained (filesystem I/O
 * only), so consuming modules just import this module.
 */
@Module({
  providers: [ImageStorageConnectorService],
  exports: [ImageStorageConnectorService],
})
export class ImageStorageConnectorModule {}
