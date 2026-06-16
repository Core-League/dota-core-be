import type { Image } from '../../entities/image/image';

/** Options for storing a batch of images under a category folder. */
export interface StoreImagesOptions {
  /** Sub-folder under `uploads/` (and the matching `/uploads/<category>` route). */
  category: string;
  /**
   * If set, images larger than this many pixels (width × height) are downscaled
   * to fit, preserving aspect ratio. Omit to keep the original resolution.
   */
  maxPixels?: number;
}

export interface IImageStorageConnectorService {
  /** Store the images; returns each file's public path (`/uploads/<category>/<file>`). */
  store(images: Image[], opts: StoreImagesOptions): Promise<string[]>;
  /** Remove files by the public paths returned from {@link store}. */
  delete(paths: string[]): Promise<void>;
}
