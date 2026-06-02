import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../connectors/auth/guards/admin.guard';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import type { SponsorView } from '../../types/entities/finance/sponsor';
import { SponsorService } from '../../use-cases/sponsor/sponsor.service';
import { SponsorInputDto } from './sponsors.dto';

@ApiTags('sponsors')
@Controller('sponsors')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SponsorsController {
  constructor(private readonly sponsorService: SponsorService) {}

  @Get()
  @ApiOperation({ summary: 'List sponsors' })
  list(): Promise<SponsorView[]> {
    return this.sponsorService.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a sponsor' })
  create(@Body() body: SponsorInputDto): Promise<SponsorView> {
    return this.sponsorService.create(body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a sponsor' })
  update(
    @Param('id') id: string,
    @Body() body: SponsorInputDto,
  ): Promise<SponsorView> {
    return this.sponsorService.update({ id, ...body });
  }
}
