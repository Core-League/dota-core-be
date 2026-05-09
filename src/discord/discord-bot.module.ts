import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DiscordBotService } from './discord-bot.service';

@Module({
  imports: [HttpModule.register({ timeout: 10000, maxRedirects: 3 })],
  providers: [DiscordBotService],
  exports: [DiscordBotService],
})
export class DiscordBotModule {}
