import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DuelMatchmakerScheduler } from './duel-matchmaker.scheduler';
import { DuelMatchmakerService } from './duel-matchmaker.service';
import { DuelsAdminController } from './duels-admin.controller';
import { DuelsController } from './duels.controller';
import { DuelsCoreModule } from './duels-core.module';

/** api-v1 side of the 1v1 ladder: HTTP endpoints + the matchmaker tick. */
@Module({
  imports: [DuelsCoreModule, AuthModule],
  controllers: [DuelsController, DuelsAdminController],
  providers: [DuelMatchmakerService, DuelMatchmakerScheduler],
})
export class DuelsModule {}
