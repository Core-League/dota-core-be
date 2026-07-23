import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../../connectors/auth/guards/admin.guard';
import { JwtAuthGuard } from '../../connectors/auth/guards/jwt-auth.guard';
import { ConfigConnectorService } from '../../connectors/config/config-connector.service';
import { MonobankService } from '../../connectors/monobank/monobank.service';
import {
  SetWebhookRequestDto,
  SetWebhookResultDto,
  WebhookStatusDto,
} from './bank-webhook.dto';

/**
 * Admin surface for the Monobank push subscription. Registration used to be an
 * out-of-band curl, which is how the app shipped with no webhook at all: nothing
 * in the codebase called `setWebhook`, so entry-fee payments never reconciled.
 *
 * `GET` is also the only way to map a `send.monobank.ua/{sendId}` jar link to the
 * jar `id` that webhook pushes and `MONOBANK_ACCOUNT_IDS` use.
 */
@ApiTags('bank')
@Controller('bank/webhook')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BankWebhookController {
  constructor(
    private readonly monobank: MonobankService,
    private readonly config: ConfigConnectorService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Current webhook registration, jars, and watched account ids',
    description:
      'Reads client-info. Rate-limited by Monobank to one call per 60 seconds.',
  })
  @ApiOkResponse({ type: WebhookStatusDto })
  async status(): Promise<WebhookStatusDto> {
    const info = await this.monobank.getClientInfo();
    const watched = this.watchedAccountIds();
    const expectedUrl = this.defaultWebhookUrl();
    const registered = info.webHookUrl ?? '';

    return {
      webHookUrl: registered,
      matchesExpected: registered === expectedUrl,
      expectedUrl,
      permissions: info.permissions ?? null,
      watchedAccountIds: watched,
      jars: info.jars.map((jar) => ({
        id: jar.id,
        sendId: jar.sendId ?? null,
        title: jar.title ?? null,
        balance: jar.balance,
        watched: watched.includes(jar.id),
      })),
    };
  }

  @Post()
  @ApiOperation({
    summary: 'Register the Monobank webhook URL',
    description:
      'Defaults to `${API_BASE_URL}/webhook/monobank`. Monobank probes the URL ' +
      'with a GET and only activates it on a 200, so this must point at the v2 app.',
  })
  @ApiCreatedResponse({ type: SetWebhookResultDto })
  async register(
    @Body() body: SetWebhookRequestDto,
  ): Promise<SetWebhookResultDto> {
    const url = body.url ?? this.defaultWebhookUrl();
    await this.monobank.setWebhook(url);
    return { registeredUrl: url };
  }

  /** `${API_BASE_URL}/webhook/monobank`, with any trailing slash normalised away. */
  private defaultWebhookUrl(): string {
    const base = this.config.getEnvConfig().API_BASE_URL.replace(/\/+$/, '');
    return `${base}/webhook/monobank`;
  }

  /** Mirrors IngestionService: primary account id plus the comma-separated extras. */
  private watchedAccountIds(): string[] {
    const env = this.config.getEnvConfig();
    const extras = env.MONOBANK_ACCOUNT_IDS.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return [...new Set([env.MONOBANK_ACCOUNT_ID, ...extras].filter(Boolean))];
  }
}
