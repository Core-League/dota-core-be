import { Module } from '@nestjs/common';
import { CustomOperationModule } from '../../use-cases/custom-operation/custom-operation.module';
import { OperationModule } from '../../use-cases/operation/operation.module';
import { OperationsController } from './operations.controller';

@Module({
  imports: [OperationModule, CustomOperationModule],
  controllers: [OperationsController],
})
export class OperationsControllerModule {}
