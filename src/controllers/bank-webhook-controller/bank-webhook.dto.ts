import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Webhook registration request. `url` defaults to `${API_BASE_URL}/webhook/monobank`
 * — it must resolve to the **v2** app, since v1 has no such route and Monobank
 * only activates a webhook whose probe returns 200.
 */
export const SetWebhookRequestSchema = z.object({
  url: z.string().url().optional(),
});
export class SetWebhookRequestDto extends createZodDto(
  SetWebhookRequestSchema,
) {}

/* ── Response DTOs ─────────────────────────────────────────────────────────── */

/** One jar, trimmed to the fields needed to configure ingestion. */
export const JarSummarySchema = z.object({
  id: z.string(),
  sendId: z.string().nullable(),
  title: z.string().nullable(),
  balance: z.number(),
  /** True when `id` is already covered by MONOBANK_ACCOUNT_ID(S). */
  watched: z.boolean(),
});
export class JarSummaryDto extends createZodDto(JarSummarySchema) {}

/**
 * Current Monobank wiring. Deliberately excludes the token and every account
 * field beyond ids — this is an operational view, not a bank statement.
 */
export const WebhookStatusSchema = z.object({
  /** Empty string when no webhook is registered. */
  webHookUrl: z.string(),
  /** True when `webHookUrl` matches the URL this app would register. */
  matchesExpected: z.boolean(),
  expectedUrl: z.string(),
  permissions: z.string().nullable(),
  watchedAccountIds: z.array(z.string()),
  jars: z.array(JarSummarySchema),
});
export class WebhookStatusDto extends createZodDto(WebhookStatusSchema) {}

export const SetWebhookResultSchema = z.object({
  registeredUrl: z.string(),
});
export class SetWebhookResultDto extends createZodDto(SetWebhookResultSchema) {}
