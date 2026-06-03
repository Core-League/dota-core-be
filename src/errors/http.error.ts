import { ApplicationError } from './application.error';

/** Request/response detail attached to an {@link HttpError}. */
export interface HttpErrorContext {
  method: string;
  url: string;
  /** Upstream HTTP status, or `undefined` when no response (network/timeout). */
  status?: number;
  /** Parsed body of the failed response, if any. */
  responseData?: unknown;
}

/**
 * Error raised for a failed outbound HTTP call. Being an `HttpError` IS the
 * type — branch on it with `instanceof`. The `context` field carries the
 * request/response detail for logging and recovery.
 */
export class HttpError extends ApplicationError {
  constructor(
    message: string,
    readonly context: HttpErrorContext,
    causedBy?: unknown,
  ) {
    super(message, causedBy);
  }
}
