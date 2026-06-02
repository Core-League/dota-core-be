import { ApplicationError } from './application.error';

/**
 * Raised when Bank returns `429 Too Many Requests`. Both `client-info` and
 * `statement` are limited to one call per 60 seconds — branch on this with
 * `instanceof` to back off and retry. `retryAfterSec` defaults to 60.
 */
export class BankRateLimitError extends ApplicationError {
  constructor(
    message: string,
    readonly retryAfterSec: number = 60,
    causedBy?: unknown,
  ) {
    super(message, causedBy);
  }
}

/**
 * Raised when Bank returns `403` — the `X-Token` is missing, invalid, or
 * revoked. Not retryable.
 */
export class BankAuthError extends ApplicationError {
  constructor(message: string, causedBy?: unknown) {
    super(message, causedBy);
  }
}
