import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentPlayerId } from '../../connectors/auth/current-player.decorator';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import type { VerificationRequestView } from '../../types/entities/verification/request';
import type { VerificationSlotView } from '../../types/entities/verification/slot';
import { VerificationRequestService } from '../../use-cases/verification/verification-request.service';
import { VerificationSlotService } from '../../use-cases/verification/verification-slot.service';
import { CreateRequestDto } from './verification.dto';

@ApiTags('verification')
@Controller('verification')
@UseGuards(JwtAuthGuard)
export class VerificationUserController {
  constructor(
    private readonly slotService: VerificationSlotService,
    private readonly requestService: VerificationRequestService,
  ) {}

  @Get('slots')
  @ApiOperation({
    summary: 'List free slots for a day (UTC, defaults to today)',
  })
  @ApiQuery({ name: 'date', required: false, example: '2026-06-07' })
  listFreeSlots(@Query('date') date?: string): Promise<VerificationSlotView[]> {
    return this.slotService.listFree(date);
  }

  @Post('requests')
  @ApiOperation({ summary: 'Captain books a free slot to verify players' })
  createRequest(
    @CurrentPlayerId() captainPlayerId: string,
    @Body() body: CreateRequestDto,
  ): Promise<VerificationRequestView> {
    return this.requestService.createRequest(captainPlayerId, body);
  }
}
