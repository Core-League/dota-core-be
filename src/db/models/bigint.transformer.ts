import type { ValueTransformer } from 'typeorm';

/**
 * TypeORM returns `bigint` columns as strings (they can exceed JS's safe integer
 * range). All our money is in kopecks and stays well within `Number.MAX_SAFE_INTEGER`,
 * so this transformer hydrates `bigint` columns back to `number`. `null`
 * passes through unchanged.
 */
export const bigintTransformer: ValueTransformer = {
  to: (value?: number | null): number | null | undefined => value,
  from: (value?: string | null): number | null | undefined =>
    value === null || value === undefined ? value : Number(value),
};
