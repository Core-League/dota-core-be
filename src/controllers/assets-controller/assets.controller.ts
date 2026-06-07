import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../../connectors/auth/guards/admin.guard';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import type { AssetView } from '../../types/entities/finance/asset';
import { AssetService } from '../../use-cases/asset/asset.service';
import { AssetViewDto, CreateAssetDto } from './assets.dto';

@ApiTags('assets')
@Controller('assets')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AssetsController {
  constructor(private readonly assetService: AssetService) {}

  @Get()
  @ApiOperation({
    summary: 'List managed assets (icons/logos) with resolved URLs',
  })
  @ApiOkResponse({ type: [AssetViewDto] })
  list(): Promise<AssetView[]> {
    return this.assetService.list();
  }

  @Post()
  @ApiOperation({ summary: 'Register a managed asset' })
  @ApiCreatedResponse({ type: AssetViewDto })
  create(@Body() body: CreateAssetDto): Promise<AssetView> {
    return this.assetService.create(body);
  }
}
