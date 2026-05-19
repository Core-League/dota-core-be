import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { Dota2Module } from '../dota2/dota2.module';
import { DueloService } from './duelo.service';

@Module({
  imports: [
    HttpModule.register({ timeout: 15000, maxRedirects: 3 }),
    Dota2Module,
  ],
  providers: [DueloService],
  exports: [DueloService],
})
export class DueloModule {}
