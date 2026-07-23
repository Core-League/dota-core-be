import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
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
  async status(@Req() req: Request): Promise<WebhookStatusDto> {
    const info = await this.monobank.getClientInfo();
    const watched = this.watchedAccountIds();
    const expectedUrl = this.webhookUrlFor(req);
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
    @Req() req: Request,
  ): Promise<SetWebhookResultDto> {
    const url = body.url ?? this.webhookUrlFor(req);
    await this.monobank.setWebhook(url);
    return { registeredUrl: url };
  }

  /**
   * The public URL Monobank should push to, taken from the request that reached
   * this endpoint.
   *
   * Deriving beats configuring: `/webhook/monobank` is served only by the v2 app,
   * while `API_BASE_URL` addresses v1 (it builds the public upload/asset/sponsor
   * URLs). Defaulting to it registered a URL that v1 does not route, so Monobank's
   * activation probe got a 404 and the webhook stayed inactive — no push ever
   * arrived and entry fees never reconciled on their own. An admin necessarily
   * reaches this controller on the v2 origin, so the request is the one source
   * that is always right, with no env var to keep in sync per environment.
   */
  private webhookUrlFor(req: Request): string {
    // Behind nginx the forwarded pair carries the public scheme/host; a direct
    // hit has neither, so fall back to the request's own values.
    const host = this.headerValue(req, 'x-forwarded-host') ?? req.headers.host;
    if (!host) return this.configuredWebhookUrl();

    const proto =
      this.headerValue(req, 'x-forwarded-proto') ?? req.protocol ?? 'https';
    return `${proto}://${host}/webhook/monobank`;
  }

  /** First entry of a possibly repeated/comma-joined proxy header, or null. */
  private headerValue(req: Request, name: string): string | null {
    const raw = req.headers[name];
    const first = Array.isArray(raw) ? raw[0] : raw;
    const value = first?.split(',')[0]?.trim();
    return value ? value : null;
  }

  /** Last-resort default when the request carries no host (e.g. HTTP/1.0). */
  private configuredWebhookUrl(): string {
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
