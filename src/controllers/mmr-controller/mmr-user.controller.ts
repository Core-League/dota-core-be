import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import type { MmrUpdateRequestView } from '../../types/entities/mmr/request';
import { MmrUpdateService } from '../../use-cases/mmr-update/mmr-update.service';
import {
  CreateMmrRequestDto,
  CreateMmrRequestFormDto,
  MmrUpdateRequestViewDto,
} from './mmr.dto';
import { MAX_PROOFS, proofUploadOptions } from './proof-upload';
import { toImages } from '../convertors/image.convertor';
import type { RequestWithJwtActor } from 'src/auth/guards/own-player-or-admin.guard';

@ApiTags('mmr-requests')
@Controller('mmr-requests')
@UseGuards(JwtAuthGuard)
export class MmrUserController {
  constructor(private readonly mmrService: MmrUpdateService) {}

  @Post()
  @ApiOperation({
    summary: 'Verified player submits an MMR-update request with proof images',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateMmrRequestFormDto })
  @UseInterceptors(FilesInterceptor('proofs', MAX_PROOFS, proofUploadOptions))
  @ApiCreatedResponse({ type: MmrUpdateRequestViewDto })
  submit(
    @Req() req: RequestWithJwtActor,
    @Body() body: CreateMmrRequestDto,
    @UploadedFiles() proofs: Express.Multer.File[],
  ): Promise<MmrUpdateRequestView> {
    return this.mmrService.submit(req.user!.playerId, {
      newMmr: body.newMmr,
      proofs: toImages(proofs ?? []),
    });
  }

  @Get('me')
  @ApiOperation({ summary: "The current player's MMR-update request, if any" })
  @ApiOkResponse({ type: MmrUpdateRequestViewDto })
  getMine(
    @Req() req: RequestWithJwtActor,
  ): Promise<MmrUpdateRequestView | null> {
    return this.mmrService.getMine(req.user!.playerId);
  }
}
