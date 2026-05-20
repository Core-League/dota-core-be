import { BadRequestException, Injectable } from '@nestjs/common';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import * as multer from 'multer';

/** Дозволені MIME; частина браузерів/ОС надсилає нестандартні значення (наприклад image/jpg без image/jpeg). */
const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/x-png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/svg',
]);

/** Якщо Content-Type бракований/пустий — остання спроба за безпечним розширенням імені файлу. */
const EXT_TO_IMAGE_MIME: ReadonlyMap<string, string> = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.jfif', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
]);

const FILTER_REJECT_MESSAGE =
  'Дозволені лише зображення у форматі JPEG, PNG, GIF, WebP або SVG (розмір файлу до 10 МБ). Перевірте формат або спробуйте інший файл / браузер.';

/** Без параметрів після «;» (charset тощо) — інакше image/jpeg;charset=binary не потрапляє у whitelist. */
function primaryMimeType(mimetype?: string): string {
  return (mimetype ?? '').split(';')[0].trim().toLowerCase();
}

export const imageFileFilter: multer.Options['fileFilter'] = (
  _req,
  file,
  cb,
) => {
  const mime = primaryMimeType(file.mimetype);

  if (ALLOWED_IMAGE_MIME.has(mime)) {
    cb(null, true);
    return;
  }

  const ext = extname(file.originalname ?? '').toLowerCase();
  const hinted = EXT_TO_IMAGE_MIME.get(ext);

  /** Довіряємо розширенню лише коли браузер не дав нормальний MIME або надіслав generic binary/octet-stream. */
  const allowGuessByExtension =
    !mime ||
    mime === 'application/octet-stream' ||
    mime === 'binary/octet-stream';

  if (allowGuessByExtension && hinted && ALLOWED_IMAGE_MIME.has(hinted)) {
    cb(null, true);
    return;
  }

  /** BadRequestException коректно проходить через transformException Nest + Multer і стабільно серіалізує message для клієнта. */
  cb(new BadRequestException(FILTER_REJECT_MESSAGE));
};

export function createDiskStorage(category: string): multer.StorageEngine {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dest = join(process.cwd(), 'uploads', category);
      mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      cb(
        null,
        `${randomUUID()}${extname(file.originalname ?? '').toLowerCase()}`,
      );
    },
  });
}

@Injectable()
export class UploadsService {
  buildUrl(category: string, filename: string): string {
    const base = (process.env.API_BASE_URL ?? '').replace(/\/$/, '');
    return `${base}/uploads/${category}/${filename}`;
  }
}
