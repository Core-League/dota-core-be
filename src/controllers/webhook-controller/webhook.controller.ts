import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IngestionService } from '../../use-cases/ingestion/ingestion.service';

/**
 * Receiver for Monobank webhook pushes. Monobank first probes the URL with a
 * `GET` and only activates the webhook on a `200`; afterwards each new statement
 * item arrives as a `POST` body.
 */
@ApiTags('webhook')
@Controller('webhook')
export class WebhookController {
  constructor(private readonly ingestionService: IngestionService) { }

  @Get('monobank')
  @ApiOperation({ summary: 'Monobank webhook activation probe' })
  probe(): { status: string } {
    return { status: 'ok' };
  }

  @Post('monobank')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive a Monobank statement-item push' })
  async receive(@Body() body: unknown): Promise<{ status: string }> {
    await this.ingestionService.handleWebhook(body);
    return { status: 'ok' };
  }
}
