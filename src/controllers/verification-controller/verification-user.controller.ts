import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import type { VerificationRequestView } from '../../types/entities/verification/request';
import type { VerificationSlotView } from '../../types/entities/verification/slot';
import { VerificationRequestService } from '../../use-cases/verification/verification-request.service';
import { VerificationSlotService } from '../../use-cases/verification/verification-slot.service';
import {
  CreateRequestDto,
  VerificationRequestViewDto,
  VerificationSlotViewDto,
} from './verification.dto';
import type { RequestWithJwtActor } from 'src/auth/guards/own-player-or-admin.guard';

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
    summary: 'List free slots across a UTC day range (defaults to today)',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-06-07' })
  @ApiQuery({ name: 'to', required: false, example: '2026-06-09' })
  @ApiOkResponse({ type: [VerificationSlotViewDto] })
  listFreeSlots(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<VerificationSlotView[]> {
    return this.slotService.listFree(from, to);
  }

  @Post('requests')
  @ApiOperation({ summary: 'Captain books a free slot to verify players' })
  @ApiCreatedResponse({ type: VerificationRequestViewDto })
  createRequest(
    @Req() req: RequestWithJwtActor,
    @Body() body: CreateRequestDto,
  ): Promise<VerificationRequestView> {
    return this.requestService.createRequest(req.user!.playerId, body);
  }

  @Get('me')
  @ApiOperation({
    summary: "The current player's verification requests (newest first)",
  })
  @ApiOkResponse({ type: [VerificationRequestViewDto] })
  listMyRequests(
    @Req() req: RequestWithJwtActor,
  ): Promise<VerificationRequestView[]> {
    return this.requestService.listForPlayer(req.user!.playerId);
  }
}
