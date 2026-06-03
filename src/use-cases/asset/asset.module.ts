import { Module } from '@nestjs/common';
import { AssetService } from './asset.service';

/** Provides the asset catalog (repo + config come from global modules). */
@Module({
  providers: [AssetService],
  exports: [AssetService],
})
export class AssetModule {}
