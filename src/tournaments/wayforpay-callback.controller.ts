import {
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { WayForPayService } from '../connectors/wayforpay/wayforpay.service';
import {
  WfpTransactionSchema,
  parseWfpCallbackBody,
  type TWfpTransaction,
} from '../connectors/wayforpay/wayforpay.types';
import { wfpToInvoiceCallback } from '../connectors/wayforpay/wayforpay-callback.mapper';
import { VipService } from '../vip/vip.service';
import { TournamentDonationsService } from './tournament-donations.service';
import { TournamentPaymentsService } from './tournament-payments.service';

/**
 * Receiver for WayForPay `serviceUrl` callbacks (owner 2026-10-14: WayForPay
 * replaces Monobank acquiring). One URL for entry fees, donations and VIP,
 * attributed by order reference in that order; VIP also owns WayForPay's own
 * monthly charges of a subscription.
 *
 * The body is JSON — sometimes posted as the single key of a form body — so it
 * is read raw. A verified callback is answered with the signed `accept`
 * WayForPay waits for (otherwise it retries for days), including one that
 * matches nothing: retrying cannot help, and the log keeps the trace. Only a
 * failed signature is rejected.
 */
@ApiExcludeController()
@Controller('webhook/wayforpay')
export class WayForPayCallbackController {
  private readonly logger = new Logger(WayForPayCallbackController.name);

  constructor(
    private readonly wayforpay: WayForPayService,
    private readonly payments: TournamentPaymentsService,
    private readonly donations: TournamentDonationsService,
    private readonly vip: VipService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>): Promise<{
    orderReference: string;
    status: 'accept';
    time: number;
    signature: string;
  }> {
    if (!this.wayforpay.isConfigured()) {
      throw new ServiceUnavailableException('WayForPay is not configured');
    }
    const raw = await readRawBody(req);
    const parsed = WfpTransactionSchema.safeParse(
      parseWfpCallbackBody(raw.toString('utf8')),
    );
    if (!parsed.success) {
      this.logger.error(
        `WayForPay callback unreadable: ${parsed.error.message.slice(0, 300)}`,
      );
      throw new BadRequestException('Unreadable callback');
    }
    if (!this.wayforpay.verify(parsed.data)) {
      throw new ForbiddenException('Invalid signature');
    }
    await this.dispatch(parsed.data);
    return this.wayforpay.acceptReply(parsed.data.orderReference);
  }

  private async dispatch(tx: TWfpTransaction): Promise<void> {
    if (tx.currency && tx.currency !== 'UAH') {
      this.logger.error(
        `WayForPay order ${tx.orderReference} reports currency ${tx.currency}; every Core League page is in UAH`,
      );
    }
    const callback = wfpToInvoiceCallback(tx);
    if (await this.payments.applyInvoiceCallback(callback)) return;
    if (await this.donations.applyInvoiceCallback(callback)) return;
    if (await this.vip.applyWayForPayCallback(tx)) return;

    // `error`, not `warn`: this callback is accepted (WayForPay will not
    // retry), so this line is the only trace of money we cannot attribute.
    this.logger.error(
      `Unattributable WayForPay callback — status "${tx.transactionStatus ?? ''}" for order ` +
        `${tx.orderReference} (${String(tx.amount ?? '?')} ${tx.currency ?? ''}) matches no ` +
        'tournament_team_payment, tournament_donation or vip_payment row',
    );
  }
}

/**
 * The exact bytes received. Express parses JSON and form bodies (keeping
 * `rawBody`, see the v1 bootstrap); any other content type is left unread on
 * the stream.
 */
async function readRawBody(req: RawBodyRequest<Request>): Promise<Buffer> {
  if (req.rawBody) return req.rawBody;
  if (req.readableEnded) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
