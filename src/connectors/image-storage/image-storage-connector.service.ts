import { Injectable, Logger } from '@nestjs/common';
import { mkdir, unlink } from 'fs/promises';
import { extname, join } from 'path';
import sharp from 'sharp';
import type { Image } from '../../types/entities/image/image';
import type {
  IImageStorageConnectorService,
  StoreImagesOptions,
} from '../../types/interfaced/connectors/image-storage.connector.interface';

/** Folder name + public route prefix of the statically served upload tree. */
const UPLOADS_DIR = 'uploads';
/** Root of the statically served upload tree (`/uploads`). */
const UPLOADS_ROOT = join(process.cwd(), UPLOADS_DIR);

/** Map a (validated) image to a safe output extension sharp can encode. */
function outputExt(originalName: string): string {
  const ext = extname(originalName ?? '').toLowerCase();
  if (ext === '.jpeg' || ext === '.jfif') return '.jpg';
  if (ext === '.jpg' || ext === '.png' || ext === '.webp') return ext;
  return '.jpg';
}

/**
 * Owns all image I/O (sharp compression + filesystem storage) so use-cases stay
 * free of external libraries. Takes {@link Image} domain entities (raw buffers),
 * optionally downscales them to a pixel cap (aspect preserved), and writes them
 * to disk under `uploads/<category>/`. Returns each file's **public path**
 * (`/uploads/<category>/<file>`) — ready to store on an asset and resolve to a
 * URL — and deletes files by that same path.
 */
@Injectable()
export class ImageStorageConnectorService implements IImageStorageConnectorService {
  private readonly logger = new Logger(ImageStorageConnectorService.name);

  /**
   * Compress + write each image under `uploads/<category>/` as
   * `<externalId>-<originalName><ext>`; returns each file's `/uploads/...`
   * public path in input order.
   */
  async store(images: Image[], opts: StoreImagesOptions): Promise<string[]> {
    const dir = join(UPLOADS_ROOT, opts.category);
    await mkdir(dir, { recursive: true });
    const stored: string[] = [];
    try {
      for (const image of images) {
        const pipeline = sharp(image.buffer).rotate(); // honour EXIF orientation
        const meta = await pipeline.metadata();
        if (
          opts.maxPixels &&
          meta.width &&
          meta.height &&
          meta.width * meta.height > opts.maxPixels
        ) {
          const scale = Math.sqrt(opts.maxPixels / (meta.width * meta.height));
          // Floor both dimensions so the result never exceeds the cap (rounding
          // up could push width × height just past the limit).
          pipeline.resize(
            Math.floor(meta.width * scale),
            Math.floor(meta.height * scale),
          );
        }
        const filename = `${image.externalId}-${image.originalName}${outputExt(image.originalName)}`;
        await pipeline.toFile(join(dir, filename));
        stored.push(`/${UPLOADS_DIR}/${opts.category}/${filename}`);
      }
      return stored;
    } catch (err) {
      // Roll back any files already written so a mid-batch failure leaves no orphans.
      await this.delete(stored);
      throw err;
    }
  }

  /**
   * Best-effort removal of files by their public path (`/uploads/<category>/<file>`,
   * exactly what {@link store} returns); missing files are ignored.
   */
  async delete(paths: string[]): Promise<void> {
    await Promise.all(
      paths.map(async (publicPath) => {
        try {
          await unlink(join(process.cwd(), publicPath));
        } catch (err) {
          this.logger.warn(`Failed to delete ${publicPath}: ${String(err)}`);
        }
      }),
    );
  }
}
