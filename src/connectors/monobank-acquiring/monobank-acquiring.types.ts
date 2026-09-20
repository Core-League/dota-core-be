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
 * Type-only import: pins the zod enum below to the domain union in
 * `tournament-payment-transition.ts`. A value import would invert the
 * layering, so the check runs through this exhaustive map instead.
 *
 * `Record<TInvoiceStatus, true>` is checked in both directions: TypeScript
 * rejects the object literal if a member of `TInvoiceStatus` is missing, and
 * rejects it if a key is added that isn't in `TInvoiceStatus`. That is a
 * stronger guarantee than the `as const satisfies readonly T[]` form this
 * replaced — that form only proved every listed literal belongs to `T`, not
 * that every member of `T` was listed, so an added `TInvoiceStatus` member
 * could silently fall out of this enum and fail every real callback with
 * that status.
 */
const INVOICE_STATUS_MAP: Record<TInvoiceStatus, true> = {
  created: true,
  processing: true,
  hold: true,
  success: true,
  failure: true,
  reversed: true,
  expired: true,
};

const INVOICE_STATUSES = Object.keys(INVOICE_STATUS_MAP) as [
  TInvoiceStatus,
  ...TInvoiceStatus[],
];

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
