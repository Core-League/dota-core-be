import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ChallongeService } from './challonge.service';

@Module({
  imports: [HttpModule.register({ timeout: 15000, maxRedirects: 3 })],
  providers: [ChallongeService],
  exports: [ChallongeService],
})
export class ChallongeModule {}
