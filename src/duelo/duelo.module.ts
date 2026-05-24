import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/guards/admin.guard';
import { Dota2Module } from '../dota2/dota2.module';
import { DueloController } from './duelo.controller';
import { DueloService } from './duelo.service';

@Module({
  imports: [
    HttpModule.register({ timeout: 15000, maxRedirects: 3 }),
    Dota2Module,
  ],
  controllers: [DueloController],
  providers: [DueloService, AdminGuard],
  exports: [DueloService],
})
export class DueloModule {}
