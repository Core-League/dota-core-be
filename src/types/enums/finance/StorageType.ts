/**
 * Where an {@link Asset} physically lives. The public URL is derived from this
 * plus the asset's `path` at read time (never stored), so moving to another
 * backend is just a new enum case + resolver branch.
 */
export enum StorageType {
  /** Served from the app's own `/uploads` static dir (see v2 `main.ts`). */
  Local = 'LOCAL',
  /** `path` is already an absolute URL (e.g. a v1 team avatar). Used as-is. */
  ExternalUrl = 'EXTERNAL_URL',
}
