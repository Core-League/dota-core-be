import { z } from 'zod';

/**
 * An in-memory image ready to be persisted: a stable `externalId` (UUID), its
 * raw `buffer`, and the `originalName` it was uploaded under (used to derive a
 * safe output extension). Produced from a framework upload by the controller
 * image converter and consumed by the image-storage connector, which compresses
 * the buffer and writes it to disk — keeping framework upload types out of the
 * use-cases. The `externalId` is reused as the stored file name prefix and as
 * the id of the `asset` row created for the image, so one UUID identifies the
 * image across the filesystem and the database.
 */
export const ImageSchema = z.object({
  externalId: z.uuid(),
  buffer: z.instanceof(Buffer),
  originalName: z.string(),
});

export type Image = z.infer<typeof ImageSchema>;
