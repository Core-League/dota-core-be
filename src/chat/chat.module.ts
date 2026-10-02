import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Player } from '../players/player.entity';
import { ChatEventsModule } from './chat-access.events';
import { ChatAccessService } from './chat-access.service';
import { ChatMessage } from './chat-message.entity';
import { ChatReadMarker } from './chat-read-marker.entity';
import { ChatRetentionScheduler } from './chat-retention.scheduler';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

/**
 * Site chat: General / Captains / Duel / VIP channels, per-player admin threads and
 * DMs. History over `GET /chat/*`, everything live over the `/chat` socket
 * namespace, weekly purge of public channels. api-v1 only.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessage, ChatReadMarker, Player]),
    AuthModule,
    ChatEventsModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatAccessService,
    ChatService,
    ChatGateway,
    ChatRetentionScheduler,
  ],
})
export class ChatModule {}
