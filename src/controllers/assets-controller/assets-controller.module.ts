import { Module } from '@nestjs/common';
import { AssetModule } from '../../use-cases/asset/asset.module';
import { AssetsController } from './assets.controller';

@Module({
  imports: [AssetModule],
  controllers: [AssetsController],
})
export class AssetsControllerModule {}
