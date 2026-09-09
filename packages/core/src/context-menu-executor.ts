import type { MaybePromise, OperationContext } from "./contracts";
import type { ContextMenuExecutionEvent, ContextMenuExecutionMode, ContextMenuExecutionOutcome,
  ContextMenuExecutionState, ContextMenuItem, ContextMenuResult } from "./context-menu";
import { notifyHost } from "./notifications";

export type ContextMenuApplyGuard = Readonly<{
  /** Recheck immediately before committing, including after awaiting an edit lease. */
  isCurrent: () => boolean;
}>;

export type ContextMenuExecutorOptions<TContext, TChange> = Readonly<{
  /** A stable immutable snapshot reference or monotonic revision, never a fresh clone. */
  getRevision: () => unknown;
  canRun?: () => boolean;
  /** Isolate and validate a host-owned change plan before it can wait for confirmation. */
  prepareChange?: (change: TChange, context: TContext) => TChange;
  /** Validate captured identities/coordinates; throw when their meaning is no longer valid. */
  validateTarget?: (context: TContext, change: TChange) => void;
  apply: (change: TChange, context: TContext, operation: OperationContext, guard: ContextMenuApplyGuard) => MaybePromise<void>;
  onStateChange?: (state: ContextMenuExecutionState) => void;
  onEvent?: (event: ContextMenuExecutionEvent) => void;
}>;

export type ContextMenuExecutor<TContext, TChange> = Readonly<{
  getState: () => ContextMenuExecutionState;
  run: <TIcon>(item: ContextMenuItem<TContext, TChange, TIcon>, context: TContext, mode?: ContextMenuExecutionMode) => Promise<ContextMenuExecutionOutcome>;
  confirm: () => Promise<ContextMenuExecutionOutcome>;
  cancel: () => void;
  dispose: () => void;
}>;

const idle: ContextMenuExecutionState = Object.freeze({ phase: "idle", mode: "block", requestId: null,
  itemId: null, label: "", description: "", error: null, blocksChanges: false });
const changedMessage = "処理中にデータまたは対象が変更されました。内容を確認して、もう一度実行してください";

/** Let cancellation finish promptly even when a host ignores its AbortSignal. */
function abortable<T>(value: MaybePromise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new Error("処理をキャンセルしました"));
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

/** Headless prepare/confirm/apply coordinator. It never writes component data itself. */
export function createContextMenuExecutor<TContext, TChange>(
  options: ContextMenuExecutorOptions<TContext, TChange>,
): ContextMenuExecutor<TContext, TChange> {
  type Job = { context: TContext; mode: ContextMenuExecutionMode; itemId: string; label: string;
    controller: AbortController; operation: OperationContext; revision: unknown;
    result?: ContextMenuResult<TChange> };
  let state = idle;
  let current: Job | null = null;
  let disposed = false;
  let finishing = false;

  const publish = (next: ContextMenuExecutionState) => {
    state = Object.freeze(next);
    notifyHost(options.onStateChange, state);
  };
  const event = (job: Job, status: ContextMenuExecutionEvent["status"], message?: string) =>
    notifyHost(options.onEvent, Object.freeze({ type: "context-menu" as const, status,
      requestId: job.operation.requestId, itemId: job.itemId, label: job.label, ...(message ? { message } : {}) }));
  const active = (job: Job) => current === job && !disposed && !job.operation.signal.aborted;
  const finish = (job: Job, outcome: "success" | "cancelled" | "failed", message?: string): ContextMenuExecutionOutcome => {
    if (current !== job) return "cancelled";
    current = null;
    // Cleanup observers may try to start another job. Do not let the old signal's
    // abort callbacks cancel that new job or overwrite its state.
    finishing = true;
    publish({ ...idle, error: outcome === "failed" ? message ?? "処理に失敗しました" : null });
    job.controller.abort();
    finishing = false;
    event(job, outcome === "failed" ? "error" : outcome, message);
    return outcome;
  };
  const fail = (job: Job, error: unknown) => {
    if (!active(job)) return "cancelled" as const;
    // Host dialogs and fetch use the standard AbortError convention. Cross-window
    // DOMException objects may not be instanceof this realm's Error.
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError")
      return finish(job, "cancelled");
    return finish(job, "failed", error instanceof Error ? error.message : "処理に失敗しました");
  };
  const valid = (job: Job) => {
    if (!active(job) || !Object.is(job.revision, options.getRevision())) return false;
    try {
      if (job.result) options.validateTarget?.(job.context, job.result.change);
      return true;
    } catch { return false; }
  };
  const apply = async (job: Job): Promise<ContextMenuExecutionOutcome> => {
    if (!active(job) || !job.result) return "cancelled";
    try {
      if (!valid(job)) throw new Error(changedMessage);
      publish({ ...state, phase: "applying", blocksChanges: true });
      // An observer is allowed to cancel synchronously when the state changes.
      if (!valid(job)) return active(job) ? finish(job, "failed", changedMessage) : "cancelled";
      await abortable(options.apply(job.result.change, job.context, job.operation, { isCurrent: () => valid(job) }), job.operation.signal);
      // Applying the result changes the revision itself. Only its lifetime is checked here.
      return active(job) ? finish(job, "success") : "cancelled";
    } catch (error) { return fail(job, error); }
  };

  return {
    getState: () => state,
    async run(item, context, mode = "block") {
      if (disposed || finishing || item.disabled || options.canRun?.() === false || current) return "busy";
      if (!["block", "confirm", "reject-if-changed"].includes(mode)) {
        publish({ ...idle, error: "メニューの実行モードが正しくありません" });
        return "failed";
      }
      const controller = new AbortController();
      const job: Job = { context, mode, itemId: item.id, label: item.label, controller,
        operation: Object.freeze({ requestId: crypto.randomUUID(), signal: controller.signal }), revision: options.getRevision() };
      current = job;
      publish({ phase: "preparing", mode, itemId: item.id, label: item.label, requestId: job.operation.requestId,
        description: "", error: null, blocksChanges: mode === "block" });
      if (!active(job)) return "cancelled";
      event(job, "start");
      if (!active(job)) return "cancelled";
      try {
        const result = await abortable(item.onSelect(context, job.operation), job.operation.signal);
        if (!active(job)) return "cancelled";
        if (result === undefined) return finish(job, "success");
        if (!result || typeof result !== "object" || !("change" in result) ||
          (result.description !== undefined && typeof result.description !== "string")) {
          throw new Error("メニュー処理は反映する変更を返してください");
        }
        const change = options.prepareChange ? options.prepareChange(result.change, context) : result.change;
        job.result = Object.freeze({ ...result, change });
        options.validateTarget?.(context, change);
        if (mode === "confirm") {
          publish({ ...state, phase: "confirming", description: result.description ?? item.label, blocksChanges: false });
          if (!active(job)) return "cancelled";
          event(job, "confirmation-required");
          return active(job) ? "confirmation-required" : "cancelled";
        }
        return await apply(job);
      } catch (error) { return fail(job, error); }
    },
    async confirm() {
      const job = current;
      if (!job || state.phase !== "confirming") return "busy";
      // The user approves the latest data, while validateTarget retains the original target.
      job.revision = options.getRevision();
      return apply(job);
    },
    cancel() {
      if (current) finish(current, "cancelled");
    },
    dispose() {
      disposed = true;
      if (current) finish(current, "cancelled");
    },
  };
}
