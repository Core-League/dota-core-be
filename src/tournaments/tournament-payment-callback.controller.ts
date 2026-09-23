import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { MonobankAcquiringService } from '../connectors/monobank-acquiring/monobank-acquiring.service';
import {
  InvoiceCallbackSchema,
  type TInvoiceCallbackPayload,
} from '../connectors/monobank-acquiring/monobank-acquiring.types';
import { TournamentPaymentsService } from './tournament-payments.service';
import { TournamentDonationsService } from './tournament-donations.service';

/**
 * Receiver for Monobank acquiring invoice callbacks.
 *
 * Served by v1 because v1 owns `tournament_team_payment` and
 * `tournament_donation`. Acquiring takes a `webHookUrl` per invoice, so unlike
 * the Personal API statement webhook there is no registration step and no
 * chance of pointing it at the wrong app. Entry fees and donations share this
 * one URL; the payload is attributed by invoiceId/reference, entry fees first.
 *
 * Answers 200 for anything it accepts — including a payload matching no known
 * payment — so Monobank stops its three retries. Only a failed signature is
 * rejected.
 */
@ApiExcludeController()
@Controller('webhook/monobank')
export class TournamentPaymentCallbackController {
  private readonly logger = new Logger(
    TournamentPaymentCallbackController.name,
  );

  constructor(
    private readonly acquiring: MonobankAcquiringService,
    private readonly payments: TournamentPaymentsService,
    private readonly donations: TournamentDonationsService,
  ) {}

  @Post('acquiring')
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-sign') signature?: string,
  ): Promise<{ status: string }> {
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error(
        'Acquiring callback arrived without a raw body — is rawBody enabled on the v1 bootstrap?',
      );
      throw new ForbiddenException('Invalid signature');
    }

    const verified = await this.acquiring.verifyCallback(
      rawBody,
      signature ?? '',
    );
    if (!verified) throw new ForbiddenException('Invalid signature');

    const parsed = InvoiceCallbackSchema.safeParse(req.body);
    if (!parsed.success) {
      // Signed but unparseable: log and ack, since retrying cannot help.
      this.logger.error(
        `Acquiring callback failed schema validation: ${parsed.error.message}`,
      );
      return { status: 'ignored' };
    }

    await this.dispatch(parsed.data);
    return { status: 'ok' };
  }

  /**
   * Routes one verified callback: entry-fee payment (by invoiceId, then
   * reference), else donation (same order), else the unattributable log.
   */
  private async dispatch(payload: TInvoiceCallbackPayload): Promise<void> {
    if (await this.payments.applyInvoiceCallback(payload)) return;
    if (await this.donations.applyInvoiceCallback(payload)) return;

    // `error`, not `warn`: this callback settles with a 200 (Monobank will
    // not retry), so this line is the only trace that acquiring money we
    // cannot attribute to any row moved at all.
    this.logger.error(
      `Unattributable acquiring callback — status "${payload.status}" for ` +
        `reference ${payload.reference ?? '(none)'} / invoice ${payload.invoiceId} ` +
        `matches no tournament_team_payment or tournament_donation row`,
    );
  }
}
