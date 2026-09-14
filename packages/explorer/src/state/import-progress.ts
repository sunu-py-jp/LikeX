import type { ExplorerImportProgress } from "../model/upload";
import type { ExplorerNotification } from "../model/notifications";

export function describeImportProgress(value: ExplorerImportProgress): ExplorerNotification {
  const message = value.phase === "discovering" ? "フォルダ内のファイルを確認しています"
    : value.phase === "checking" ? "ファイル情報を確認しています" : "一覧への追加を準備しています";
  const count = value.total === undefined
    ? `${value.completed}ファイルを検出（総数を確認中）`
    : `${value.completed} / ${value.total}ファイル`;
  return { kind: "progress", message, description: count, persistent: true,
    progress: value.total === undefined || value.total === 0 ? undefined : value.completed / value.total * 100 };
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("読み込みを中止しました", "AbortError");
}

/** Give the browser task queue a turn; microtasks alone cannot render a spinner. */
export function yieldImportTask(signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal!.reason ?? new DOMException("読み込みを中止しました", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 0);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Throttle React updates while bounding both CPU slices and immediately-resolved native callbacks. */
export function createImportProgress(
  publish?: (value: ExplorerImportProgress) => void,
  signal?: AbortSignal,
) {
  let lastPublished = -Infinity;
  let lastYield = performance.now();
  let previous: ExplorerImportProgress | undefined;
  let steps = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearPending = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const dispose = () => { clearPending(); signal?.removeEventListener("abort", clearPending); };
  signal?.addEventListener("abort", clearPending, { once: true });
  const checkpoint = (value: ExplorerImportProgress, force = false): Promise<void> | undefined => {
    checkAbort(signal);
    const now = performance.now();
    const phaseChanged = previous?.phase !== value.phase || previous?.total !== value.total;
    if (publish && (force || phaseChanged || now - lastPublished >= 80)) {
      clearPending();
      publish(value);
      lastPublished = now;
    } else if (publish && timer === undefined && value.completed !== previous?.completed) {
      timer = setTimeout(() => {
        timer = undefined;
        if (!signal?.aborted && previous) { publish(previous); lastPublished = performance.now(); }
      }, Math.max(0, 80 - (now - lastPublished)));
    }
    previous = value;
    if (++steps < 200 && now - lastYield < 12) return;
    steps = 0;
    lastYield = now;
    return yieldImportTask(signal);
  };
  return Object.assign(checkpoint, { dispose });
}

export async function prepareImport<T>(
  operation: Generator<ExplorerImportProgress, T>,
  signal: AbortSignal,
  publish: (value: ExplorerImportProgress) => void,
): Promise<T> {
  const checkpoint = createImportProgress(publish, signal);
  // Publish before the first task boundary so a large folder picker selection
  // immediately exposes its real total and an animated progress indicator.
  try {
    checkAbort(signal);
    const first = operation.next();
    if (first.done) return first.value;
    await (checkpoint(first.value, true) ?? yieldImportTask(signal));
    for (;;) {
      checkAbort(signal);
      const step = operation.next();
      if (step.done) return step.value;
      const pause = checkpoint(step.value, step.value.completed === step.value.total);
      if (pause) await pause;
    }
  } finally { checkpoint.dispose(); }
}
