import { BadRequestException } from '@nestjs/common';
import { extname } from 'path';
import * as multer from 'multer';

/** Max proof images per request and per-file size cap. */
export const MAX_PROOFS = 3;
const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3 MB

/** Raster screenshot formats sharp can downscale; SVG/GIF are intentionally excluded. */
const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/x-png',
  'image/webp',
]);

const EXT_TO_IMAGE_MIME: ReadonlyMap<string, string> = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.jfif', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

const FILTER_REJECT_MESSAGE =
  'Дозволені лише зображення JPEG, PNG або WebP (до 10 МБ). Перевірте формат файлу.';

/** Strip charset/params after `;` so `image/jpeg;charset=binary` still matches. */
function primaryMimeType(mimetype?: string): string {
  return (mimetype ?? '').split(';')[0].trim().toLowerCase();
}

const proofImageFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const mime = primaryMimeType(file.mimetype);
  if (ALLOWED_IMAGE_MIME.has(mime)) {
    cb(null, true);
    return;
  }

  const ext = extname(file.originalname ?? '').toLowerCase();
  const hinted = EXT_TO_IMAGE_MIME.get(ext);
  const allowGuessByExtension =
    !mime ||
    mime === 'application/octet-stream' ||
    mime === 'binary/octet-stream';

  if (allowGuessByExtension && hinted && ALLOWED_IMAGE_MIME.has(hinted)) {
    cb(null, true);
    return;
  }

  cb(new BadRequestException(FILTER_REJECT_MESSAGE));
};

/**
 * Multer options for proof uploads: memory storage (so the buffers reach sharp
 * for compression), image-only filter, and size/count limits.
 */
export const proofUploadOptions: multer.Options = {
  storage: multer.memoryStorage(),
  fileFilter: proofImageFileFilter,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_PROOFS },
};
