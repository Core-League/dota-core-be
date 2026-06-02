import { registerAs } from '@nestjs/config';
import type { ConfigObject } from '@nestjs/config';
import type { ZodType } from 'zod';

/**
 * Wraps NestJS `registerAs` so a config namespace is validated against a Zod
 * schema at registration time. A misconfigured environment throws on boot.
 */
export function createConfigNamespace<T extends ConfigObject>(
  name: string,
  configData: Record<string, string | undefined>,
  validationSchema: ZodType<T>,
) {
  return registerAs(name, (): T => validationSchema.parse(configData));
}
