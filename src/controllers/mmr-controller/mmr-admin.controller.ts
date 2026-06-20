import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import type { MmrUpdateRequestView } from '../../types/entities/mmr/request';
import { MmrUpdateRequestStatus } from '../../types/enums/mmr/MmrUpdateRequestStatus';
import { MmrUpdateService } from '../../use-cases/mmr-update/mmr-update.service';
import { MmrUpdateRequestViewDto } from './mmr.dto';

@ApiTags('admin-mmr-requests')
@Controller('mmr-requests')
@UseGuards(JwtAuthGuard, AdminGuard)
export class MmrAdminController {
  constructor(private readonly mmrService: MmrUpdateService) {}

  @Get()
  @ApiOperation({
    summary: 'Admin list of MMR-update requests (with proof images)',
  })
  @ApiQuery({ name: 'status', required: false, enum: MmrUpdateRequestStatus })
  @ApiOkResponse({ type: [MmrUpdateRequestViewDto] })
  list(
    @Query('status') status?: MmrUpdateRequestStatus,
  ): Promise<MmrUpdateRequestView[]> {
    return this.mmrService.listForAdmin(status);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: "Approve a request and write the player's new MMR" })
  @ApiCreatedResponse({ type: MmrUpdateRequestViewDto })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MmrUpdateRequestView> {
    return this.mmrService.approve(id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a request and remove its proof images' })
  @ApiCreatedResponse({ type: MmrUpdateRequestViewDto })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MmrUpdateRequestView> {
    return this.mmrService.reject(id);
  }
}
