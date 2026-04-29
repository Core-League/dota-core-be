import { Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import * as multer from 'multer';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

export const imageFileFilter: multer.Options['fileFilter'] = (
  _req,
  file,
  cb,
) => {
  if (ALLOWED_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new UnsupportedMediaTypeException('Only image files are allowed'));
  }
};

export function createDiskStorage(category: string): multer.StorageEngine {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dest = join(process.cwd(), 'uploads', category);
      mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
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
