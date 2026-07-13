import { Module } from '@nestjs/common';
import { DiscordConnectorModule } from '../../connectors/discord/discord-connector.module';
import { Dota2Module } from '../../dota2/dota2.module';
import { VerificationRequestService } from './verification-request.service';
import { VerificationSlotService } from './verification-slot.service';

@Module({
  imports: [Dota2Module, DiscordConnectorModule],
  providers: [VerificationSlotService, VerificationRequestService],
  exports: [VerificationSlotService, VerificationRequestService],
})
export class VerificationModule {}
