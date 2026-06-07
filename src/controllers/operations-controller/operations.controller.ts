import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../../connectors/auth/guards/admin.guard';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import type { CustomCategoryView } from '../../types/entities/finance/custom-category';
import type { FeedView } from '../../types/entities/finance/feed';
import type { OperationGroupView } from '../../types/entities/finance/operation-group';
import { CustomOperationService } from '../../use-cases/custom-operation/custom-operation.service';
import { OperationService } from '../../use-cases/operation/operation.service';
import {
  CreateCategoryDto,
  CustomCategoryViewDto,
  FeedViewDto,
  GroupOperationsDto,
  OperationGroupViewDto,
  StatusResponseDto,
  UpdateCategoryDto,
  UpdateOperationDto,
  UpdateOperationGroupDto,
} from './operations.dto';

/** The operations feed plus manual custom-operation edits. */
@ApiTags('operations')
@Controller()
// TODO
// @UseGuards(JwtAuthGuard, AdminGuard)
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
  @ApiQuery({ name: 'showHidden', required: false, type: Boolean })
  @ApiOkResponse({ type: FeedViewDto })
  listFeed(
    @Query('includeForecast') includeForecast?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('showHidden') showHidden?: string,
  ): Promise<FeedView> {
    return this.operationService.listFeed(
      {
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        showHidden: showHidden === 'true',
      },
      includeForecast === 'true',
    );
  }

  @Patch('operations/:id')
  @ApiOperation({
    summary: 'Update an operation (title, icon, category, comment)',
  })
  @ApiOkResponse({ type: StatusResponseDto })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateOperationDto,
  ): Promise<{ status: string }> {
    await this.customOperationService.updateOperation(id, body);
    return { status: 'ok' };
  }

  @Post('operations/group')
  @ApiOperation({ summary: 'Manually group operations' })
  @ApiCreatedResponse({ type: OperationGroupViewDto })
  groupOperations(
    @Body() body: GroupOperationsDto,
  ): Promise<OperationGroupView> {
    return this.customOperationService.groupOperations(
      body.operationIds,
      body.title,
      body.iconAssetId,
    );
  }

  @Patch('operations/group/:id')
  @ApiOperation({ summary: 'Update a group (title, icon, members)' })
  @ApiOkResponse({ type: OperationGroupViewDto })
  updateGroup(
    @Param('id') id: string,
    @Body() body: UpdateOperationGroupDto,
  ): Promise<OperationGroupView> {
    return this.customOperationService.updateGroup(id, body);
  }

  @Delete('operations/group/:id')
  @ApiOperation({
    summary: 'Delete a group; its operations are ungrouped',
  })
  @ApiOkResponse({ type: StatusResponseDto })
  async deleteGroup(@Param('id') id: string): Promise<{ status: string }> {
    await this.customOperationService.deleteGroup(id);
    return { status: 'ok' };
  }

  @Get('custom-categories')
  @ApiOperation({ summary: 'List reusable categories' })
  @ApiOkResponse({ type: [CustomCategoryViewDto] })
  listCategories(): Promise<CustomCategoryView[]> {
    return this.customOperationService.listCategories();
  }

  @Post('custom-categories')
  @ApiOperation({ summary: 'Create a reusable category' })
  @ApiCreatedResponse({ type: CustomCategoryViewDto })
  createCategory(@Body() body: CreateCategoryDto): Promise<CustomCategoryView> {
    return this.customOperationService.createCategory(body);
  }

  @Patch('custom-categories/:id')
  @ApiOperation({ summary: 'Edit a category (label, icon, sign, matchers)' })
  @ApiOkResponse({ type: CustomCategoryViewDto })
  updateCategory(
    @Param('id') id: string,
    @Body() body: UpdateCategoryDto,
  ): Promise<CustomCategoryView> {
    return this.customOperationService.updateCategory(id, body);
  }

  @Delete('custom-categories/:id')
  @ApiOperation({
    summary: 'Delete a category; assigned operations are unset to null',
  })
  @ApiOkResponse({ type: StatusResponseDto })
  async deleteCategory(@Param('id') id: string): Promise<{ status: string }> {
    await this.customOperationService.deleteCategory(id);
    return { status: 'ok' };
  }
}
