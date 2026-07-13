import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DiscordConnectorService } from './discord-connector.service';

@Module({
  imports: [HttpModule.register({ timeout: 10000, maxRedirects: 3 })],
  providers: [DiscordConnectorService],
  exports: [DiscordConnectorService],
})
export class DiscordConnectorModule {}
