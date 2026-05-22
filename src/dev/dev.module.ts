import { Module } from '@nestjs/common';
import { ChallongeModule } from '../challonge/challonge.module';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';

@Module({
  imports: [ChallongeModule],
  controllers: [DevController],
  providers: [DevService],
})
export class DevModule {}
