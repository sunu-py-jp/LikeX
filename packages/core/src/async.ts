import type { MaybePromise } from "./contracts";

export function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return value !== null && (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<T>).then === "function";
}

/** Preserve synchronous results when neither the operation nor continuation waits. */
export function chainResult<T, TResult>(
  value: MaybePromise<T>,
  next: (value: T) => MaybePromise<TResult>,
): MaybePromise<TResult> {
  return isPromiseLike(value) ? Promise.resolve(value).then(next) : next(value);
}
