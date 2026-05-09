/** @types/express v5 не підвантажує `Express.Multer.File` без явного merge з @types/multer. */
import 'multer';

declare global {
  namespace Express {
    namespace Multer {
      export interface File {
        fieldname: string;
        originalname: string;
        encoding: string;
        mimetype: string;
        size: number;
        destination: string;
        filename: string;
        path: string;
        buffer: Buffer;
      }
    }
  }
}

export {};
