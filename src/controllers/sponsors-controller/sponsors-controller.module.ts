import { Module } from '@nestjs/common';
import { SponsorModule } from '../../use-cases/sponsor/sponsor.module';
import { SponsorsController } from './sponsors.controller';

@Module({
  imports: [SponsorModule],
  controllers: [SponsorsController],
})
export class SponsorsControllerModule {}
