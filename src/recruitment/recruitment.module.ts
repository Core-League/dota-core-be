import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Player } from '../players/player.entity';
import { Team } from '../teams/team.entity';
import { TeamsModule } from '../teams/teams.module';
import { PlayerRecruitmentPost } from './player-recruitment-post.entity';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentScheduler } from './recruitment.scheduler';
import { RecruitmentService } from './recruitment.service';
import { TeamJoinRequest } from './team-join-request.entity';
import { TeamRecruitmentPost } from './team-recruitment-post.entity';

/**
 * "Пошук команди / гравця" (`/recruitment`): team posts, player listings,
 * applications and invites. Roster changes go through `TeamsService`,
 * bell entries through `NotificationsService`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TeamRecruitmentPost,
      PlayerRecruitmentPost,
      TeamJoinRequest,
      Player,
      Team,
    ]),
    AuthModule,
    TeamsModule,
    NotificationsModule,
  ],
  controllers: [RecruitmentController],
  providers: [RecruitmentService, RecruitmentScheduler],
})
export class RecruitmentModule {}
