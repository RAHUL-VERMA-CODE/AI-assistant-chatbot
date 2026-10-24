/**
 * Application error hierarchy with HTTP status code mappings.
 * Guarantees zero sensitive data or stack traces leaked to clients in production.
 */

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'STALE_DATA'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface SerializedError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(requestId?: string): SerializedError {
    return {
      code: this.code,
      message: this.message,
      ...(requestId ? { requestId } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Invalid or missing authentication credentials') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied to requested resource') {
    super('FORBIDDEN', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} with id '${id}' was not found`, 404, { resource, id });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, 409, details);
  }
}

export class StaleDataError extends ConflictError {
  constructor(entity: string, expectedVersion: number, currentVersion: number) {
    super(`Stale ${entity} version: expected ${expectedVersion}, but current is ${currentVersion}. Refresh required.`, {
      entity,
      expectedVersion,
      currentVersion,
    });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 422, details);
  }
}

export class RateLimitExceededError extends AppError {
  constructor(retryAfterSeconds: number, scope: string) {
    super('RATE_LIMITED', `Rate limit exceeded for ${scope}. Try again in ${retryAfterSeconds} seconds.`, 429, {
      retryAfterSeconds,
      scope,
    });
  }
}

export class ProviderUnavailableError extends AppError {
  constructor(providerName: string, reason?: string) {
    super('PROVIDER_UNAVAILABLE', `External AI provider '${providerName}' is currently unavailable.`, 503, {
      providerName,
      ...(reason ? { reason } : {}),
    });
  }
}
