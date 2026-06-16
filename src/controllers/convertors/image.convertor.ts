import { randomUUID } from 'crypto';
import type { Image } from '../../types/entities/image/image';

/**
 * Converts framework (multer) uploads at the HTTP boundary into {@link Image}
 * domain entities, so use-cases and connectors never touch `Express.Multer.File`.
 * Each image gets a fresh `externalId` here — the single UUID later reused as its
 * stored file name prefix and as its `asset` row id.
 */
export function toImage(file: Express.Multer.File): Image {
  return {
    externalId: randomUUID(),
    buffer: file.buffer,
    originalName: file.originalname,
  };
}

export function toImages(files: Express.Multer.File[]): Image[] {
  return files.map(toImage);
}
