/**
 * Generic Result Monad for type-safe error handling without exceptions.
 */

export type Result<T, E = Error> = Ok<T, E> | Err<T, E>;

export class Ok<T, E = Error> {
  public readonly isOk = true;
  public readonly isErr = false;
  public readonly value: T;

  constructor(value: T) {
    this.value = value;
  }

  public map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }

  public flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
    return fn(this.value);
  }

  public match<R>(patterns: { ok: (value: T) => R; err: (error: E) => R }): R {
    return patterns.ok(this.value);
  }

  public unwrap(): T {
    return this.value;
  }

  public unwrapOr(_defaultValue: T): T {
    return this.value;
  }
}

export class Err<T, E = Error> {
  public readonly isOk = false;
  public readonly isErr = true;
  public readonly error: E;

  constructor(error: E) {
    this.error = error;
  }

  public map<U>(_fn: (value: T) => U): Result<U, E> {
    return new Err(this.error);
  }

  public flatMap<U>(_fn: (value: T) => Result<U, E>): Result<U, E> {
    return new Err(this.error);
  }

  public match<R>(patterns: { ok: (value: T) => R; err: (error: E) => R }): R {
    return patterns.err(this.error);
  }

  public unwrap(): T {
    if (this.error instanceof Error) {
      throw this.error;
    }
    throw new Error(String(this.error));
  }

  public unwrapOr(defaultValue: T): T {
    return defaultValue;
  }
}

export const ok = <T, E = Error>(value: T): Result<T, E> => new Ok<T, E>(value);
export const err = <T, E = Error>(error: E): Result<T, E> => new Err<T, E>(error);
