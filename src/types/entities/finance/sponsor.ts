import { z } from 'zod';
import { SponsorKind } from '../../enums/finance/SponsorKind';
import { AssetSchema, AssetViewSchema } from './asset';

/**
 * A betking / Duelo GG income source. `matchers` are substrings tested against a
 * transaction's `description` (and, for Duelo, `counterIban` of the ФОП account —
 * the Personal API does not expose card numbers). Supplies the logo and name the
 * classifier puts on the resulting operation.
 */
export const SponsorSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** FK to the managed asset used as this sponsor's logo. */
  logoAssetId: z.string().nullable(),
  kind: z.enum(SponsorKind),
  matchers: z.array(z.string()).default([]),
});

export type Sponsor = z.infer<typeof SponsorSchema>;

export const SponsorWithAttachmentSchema = SponsorSchema.extend({
  logoAsset: AssetSchema.nullable(),
});

export type SponsorWithAttachment = z.infer<typeof SponsorWithAttachmentSchema>;

export const SponsorViewSchema = SponsorSchema.omit({
  logoAssetId: true,
}).extend({
  logo: AssetViewSchema.nullable(),
});

export type SponsorView = z.infer<typeof SponsorViewSchema>;
