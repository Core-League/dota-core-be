import { z } from 'zod';
import type { TInvoiceStatus } from '../../tournaments/tournament-payment-transition';

/** Request body for `POST /api/merchant/invoice/create`. */
export type TCreateInvoiceParams = {
  /** Kopecks. */
  amount: number;
  reference: string;
  /** Human-readable purpose shown on the payment page. */
  destination: string;
  redirectUrl: string;
  webHookUrl: string;
  validitySec: number;
};

export type TCreatedInvoice = {
  invoiceId: string;
  pageUrl: string;
};

/**
 * Type-only import: pins this list to the domain union in
 * `tournament-payment-transition.ts` so the two cannot drift. A value import
 * would invert the layering; `satisfies` gives the same guarantee at compile
 * time with no runtime edge.
 */
const INVOICE_STATUSES = [
  'created',
  'processing',
  'hold',
  'success',
  'failure',
  'reversed',
  'expired',
] as const satisfies readonly TInvoiceStatus[];

const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);

/**
 * The acquiring callback body. Deliberately permissive about fields we do not
 * act on (`paymentInfo`, `cancelList`, `walletData`) — a new field from
 * Monobank must not turn a real payment into a parse failure.
 */
export const InvoiceCallbackSchema = z
  .object({
    invoiceId: z.string().min(1),
    status: InvoiceStatusSchema,
    amount: z.number().int().optional(),
    finalAmount: z.number().int().optional(),
    reference: z.string().optional(),
    modifiedDate: z.string().optional(),
    failureReason: z.string().optional(),
    errCode: z.string().optional(),
  })
  .passthrough();

export type TInvoiceCallbackPayload = z.infer<typeof InvoiceCallbackSchema>;

const CreateInvoiceResponseSchema = z.object({
  invoiceId: z.string().min(1),
  pageUrl: z.string().min(1),
});

const PubkeyResponseSchema = z.object({ key: z.string().min(1) });

export { CreateInvoiceResponseSchema, PubkeyResponseSchema };
