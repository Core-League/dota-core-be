import { Module } from '@nestjs/common';
import { AssetModule } from '../asset/asset.module';
import { SponsorModule } from '../sponsor/sponsor.module';
import { TeamModule } from '../team/team.module';
import { ClassificationService } from './classification.service';

@Module({
  imports: [SponsorModule, TeamModule, AssetModule],
  providers: [ClassificationService],
  exports: [ClassificationService],
})
export class ClassificationModule {}
