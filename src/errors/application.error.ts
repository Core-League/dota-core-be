/**
 * Base class for all v2 application errors. Carries a human-readable `message`
 * and an optional `causedBy` (the original error/value that triggered this one,
 * preserved for logging without leaking through the type system).
 *
 * The error's category is expressed by its concrete subclass — `HttpError`, and
 * future `DbError` / `AppError` — discriminated with `instanceof`. There is
 * deliberately no `type` field.
 */
export class ApplicationError extends Error {
  constructor(
    message: string,
    readonly causedBy?: unknown,
  ) {
    super(message);
    // new.target resolves to the concrete subclass (HttpError, …).
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}
