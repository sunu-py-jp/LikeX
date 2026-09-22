import type { OfficePackageSignal } from "../ooxml";

function abortReason(signal: OfficePackageSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("画像出力を中止しました");
  error.name = "AbortError";
  return error;
}

export function throwIfSlideImageAborted(signal?: OfficePackageSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

/** Settle on abort even when host work ignores its signal; observe late failures. */
export function awaitSlideImageTask<T>(task: () => PromiseLike<T> | T, signal?: OfficePackageSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortReason(signal!)));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    try {
      Promise.resolve(task()).then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    } catch (error) { finish(() => reject(error)); }
  });
}
