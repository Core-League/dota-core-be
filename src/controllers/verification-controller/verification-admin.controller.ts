import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../../connectors/auth/guards/admin.guard';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import type { VerificationRequestView } from '../../types/entities/verification/request';
import type { VerificationSlotView } from '../../types/entities/verification/slot';
import { VerificationRequestService } from '../../use-cases/verification/verification-request.service';
import { VerificationSlotService } from '../../use-cases/verification/verification-slot.service';
import {
  CompleteRequestDto,
  CreateSlotsDto,
  VerificationRequestViewDto,
  VerificationSlotViewDto,
} from './verification.dto';

@ApiTags('admin-verification')
@Controller('verification')
@UseGuards(JwtAuthGuard, AdminGuard)
export class VerificationAdminController {
  constructor(
    private readonly slotService: VerificationSlotService,
    private readonly requestService: VerificationRequestService,
  ) {}

  @Post('slots')
  @ApiOperation({
    summary: 'Publish free 30-min slots for explicit start times',
  })
  @ApiCreatedResponse({ type: [VerificationSlotViewDto] })
  createSlots(@Body() body: CreateSlotsDto): Promise<VerificationSlotView[]> {
    return this.slotService.createSlots(body);
  }

  @Delete('slots/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove a free slot, or cancel a booked slot + its request',
  })
  @ApiNoContentResponse()
  async deleteSlot(@Param('id') id: string): Promise<void> {
    await this.requestService.deleteSlot(id);
  }

  @Get('requests')
  @ApiOperation({
    summary:
      'Admin list of bookings across a UTC day range (defaults to today)',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-06-07' })
  @ApiQuery({ name: 'to', required: false, example: '2026-06-09' })
  @ApiOkResponse({ type: [VerificationRequestViewDto] })
  listRequests(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<VerificationRequestView[]> {
    return this.requestService.listInRange(from, to);
  }

  @Post('requests/:id/process')
  @ApiOperation({ summary: 'Admin takes a request into processing' })
  @ApiCreatedResponse({ type: VerificationRequestViewDto })
  processRequest(@Param('id') id: string): Promise<VerificationRequestView> {
    return this.requestService.process(id);
  }

  @Post('requests/:id/complete')
  @ApiOperation({
    summary: 'Admin completes a request and writes per-player MMR',
  })
  @ApiCreatedResponse({ type: VerificationRequestViewDto })
  completeRequest(
    @Param('id') id: string,
    @Body() body: CompleteRequestDto,
  ): Promise<VerificationRequestView> {
    return this.requestService.complete(id, body);
  }

  @Post('requests/:id/cancel')
  @ApiOperation({ summary: 'Admin cancels a request and frees its slot' })
  @ApiCreatedResponse({ type: VerificationRequestViewDto })
  cancelRequest(@Param('id') id: string): Promise<VerificationRequestView> {
    return this.requestService.cancel(id);
  }
}
