import { Module } from '@nestjs/common';
import { TagsModule } from '../../use-cases/tags/tags.module';
import { TagsController } from './tags.controller';

@Module({
  imports: [TagsModule],
  controllers: [TagsController],
})
export class TagsControllerModule {}
