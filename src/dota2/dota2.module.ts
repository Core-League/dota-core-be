import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { Dota2Service } from './dota2.service';

@Module({
  imports: [HttpModule.register({ timeout: 15000, maxRedirects: 3 })],
  providers: [Dota2Service],
  exports: [Dota2Service],
})
export class Dota2Module {}
