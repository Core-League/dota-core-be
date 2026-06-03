import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../connectors/auth/guards/admin.guard';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import type { CustomCategoryView } from '../../types/entities/finance/custom-category';
import type { FeedView } from '../../types/entities/finance/feed';
import type { OperationGroupView } from '../../types/entities/finance/operation-group';
import { CustomOperationService } from '../../use-cases/custom-operation/custom-operation.service';
import { OperationService } from '../../use-cases/operation/operation.service';
import {
  CreateCategoryDto,
  GroupOperationsDto,
  RenameOperationDto,
  SetIconDto,
} from './operations.dto';

/** The operations feed plus manual custom-operation edits. */
@ApiTags('operations')
@Controller()
@UseGuards(JwtAuthGuard, AdminGuard)
export class OperationsController {
  constructor(
    private readonly operationService: OperationService,
    private readonly customOperationService: CustomOperationService,
  ) { }

  @Get('operations')
  @ApiOperation({ summary: 'Operations feed (optionally with forecast rows)' })
  @ApiQuery({ name: 'includeForecast', required: false, type: Boolean })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  listFeed(
    @Query('includeForecast') includeForecast?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<FeedView> {
    return this.operationService.listFeed(
      {
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      },
      includeForecast === 'true',
    );
  }

  @Patch('operations/:id/rename')
  @ApiOperation({ summary: 'Rename an operation' })
  async rename(
    @Param('id') id: string,
    @Body() body: RenameOperationDto,
  ): Promise<{ status: string }> {
    await this.customOperationService.rename(id, body.label);
    return { status: 'ok' };
  }

  @Patch('operations/:id/icon')
  @ApiOperation({ summary: 'Set an operation icon' })
  async setIcon(
    @Param('id') id: string,
    @Body() body: SetIconDto,
  ): Promise<{ status: string }> {
    await this.customOperationService.setIcon(id, body.iconAssetId);
    return { status: 'ok' };
  }

  @Post('operations/group')
  @ApiOperation({ summary: 'Manually group operations' })
  groupOperations(
    @Body() body: GroupOperationsDto,
  ): Promise<OperationGroupView> {
    return this.customOperationService.groupOperations(
      body.operationIds,
      body.title,
      body.iconAssetId,
    );
  }

  @Post('custom-categories')
  @ApiOperation({ summary: 'Create a reusable custom category' })
  createCategory(@Body() body: CreateCategoryDto): Promise<CustomCategoryView> {
    return this.customOperationService.createCategory(body.label, body.iconAssetId);
  }
}
