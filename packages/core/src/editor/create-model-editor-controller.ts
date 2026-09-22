import type { OperationContext } from "../contracts";
import type { ModelEditorAdapter, ModelEditorEvent, ModelEditorExecuteOptions, ModelEditorNotice, ModelEditorOptions, ModelEditorSnapshot, ModelEditorTaskContext } from "./types";

type Operation = OperationContext & { token: number; epoch: number };
/** Shared, React-free host coordination for independent JSON editors. */
export function createModelEditorController<M, C, F extends string>(adapter: ModelEditorAdapter<M, C, F>, initialModel: M, initialOptions: ModelEditorOptions<M, F> = {}) {
  let options = initialOptions, model = freeze(initialModel), modelJson = adapter.serialize(model), baseline = modelJson;
  let baselineModel = model, alive = true, epoch = 0, token = 0, abort = new AbortController();
  let busy: ModelEditorSnapshot<M, F>["busy"] = null, editMode: ModelEditorSnapshot<M, F>["editMode"] = "view", notice: ModelEditorNotice | null = null;
  let lastGroup: string | undefined, lastTime = 0;
  type HistoryEntry = { model: M; features: readonly F[] };
  const past: HistoryEntry[] = [], future: HistoryEntry[] = [], listeners = new Set<() => void>();
  let flags = resolve(), readonly = isReadOnly();
  let snapshot = makeSnapshot();
  function freeze(value: M): M {
    // Always copy at the host boundary. A retained input or callback payload cannot mutate history.
    const copy = adapter.normalize(structuredClone(value));
    function visit(input: unknown) { if (input !== null && typeof input === "object") { for (const child of Object.values(input)) visit(child); Object.freeze(input); } }
    visit(copy); return copy;
  }
  function resolve() { return Object.freeze(Object.fromEntries(adapter.features.map(key => [key, options.features?.[key] !== false]))) as Readonly<Record<F, boolean>>; }
  function isReadOnly() { return options.readOnly === true || typeof options.onSave !== "function"; }
  function makeSnapshot(): ModelEditorSnapshot<M, F> { return Object.freeze({ model, dirty: modelJson !== baseline, canUndo: past.length > 0 && past.at(-1)!.features.every(enabled), canRedo: future.length > 0 && future.at(-1)!.features.every(enabled), readOnly: readonly, editable: !readonly && !busy, features: flags, busy, editMode, notice }); }
  function safely(callback: (() => unknown) | undefined) { try { void Promise.resolve(callback?.()).catch(() => {}); } catch { /* Observers do not roll back committed changes. */ } }
  function emit(event: ModelEditorEvent<M>) { if (alive) safely(() => options.onEvent?.(event)); }
  function publish() {
    const before = snapshot; snapshot = makeSnapshot();
    if (alive) { for (const callback of [...listeners]) safely(callback); if (before.dirty !== snapshot.dirty) safely(() => options.onDirtyChange?.(snapshot.dirty)); }
  }
  function setNotice(value: ModelEditorNotice | null) { notice = value; if (alive) publish(); }
  function report(cause: unknown) { if (alive) setNotice({ kind: "error", text: cause instanceof Error ? cause.message : "処理に失敗しました。" }); }
  function writable() { return alive && !isReadOnly(); }
  function enabled(feature: F | string) { return !adapter.features.includes(feature as F) || options.features?.[feature as F] !== false; }
  function assertFeatures(commands: readonly C[]) {
    for (const command of commands) for (const feature of adapter.getCommandFeatures(command)) if (!enabled(feature)) throw new Error("この機能は無効です。");
  }
  function asCommands(command: C | readonly C[]) { return (Array.isArray(command) ? command : [command]) as readonly C[]; }
  function stage(commands: readonly C[]) { assertFeatures(commands); return freeze(adapter.normalize(adapter.execute(model, commands))); }
  function change(next: M, source: Extract<ModelEditorEvent<M>, { type: "change" }>["source"], group?: string, requirements: readonly F[] = []) {
    const nextJson = adapter.serialize(next);
    if (nextJson === modelJson) return null;
    const now = Date.now();
    if (!group || group !== lastGroup || !group.startsWith("task:") && now - lastTime > 1000) { past.push({ model, features: [...new Set(requirements)] }); if (past.length > 100) past.shift(); }
    else if (past.length) { const entry = past.at(-1)!; entry.features = [...new Set([...entry.features, ...requirements])]; }
    lastGroup = group; lastTime = now; future.length = 0; model = next; modelJson = nextJson; notice = null;
    publish(); safely(() => options.onChange?.(model)); emit({ type: "change", source, model }); return model;
  }
  function reserve(kind: NonNullable<typeof busy>): Operation { busy = kind; const operation = { token: ++token, epoch, requestId: crypto.randomUUID(), signal: abort.signal }; publish(); return operation; }
  function current(operation: Operation) { return alive && token === operation.token && epoch === operation.epoch && !operation.signal.aborted; }
  function release(operation: Operation) { if (token === operation.token) { busy = null; if (alive) publish(); } }
  function endEdit() { editMode = "view"; emit({ type: "edit-mode", mode: "view" }); }
  function cancelPending() { epoch++; token++; abort.abort(); abort = new AbortController(); busy = null; lastGroup = undefined; if (editMode === "requesting") endEdit(); if (alive) publish(); }
  function permitted<T>(apply: () => T, fallback: T): Promise<T> {
    if (!writable() || busy) return Promise.resolve(fallback);
    const starting = editMode !== "edit";
    if (!starting || !options.onEditRequest) {
      if (starting) { editMode = "edit"; emit({ type: "edit-mode", mode: "edit" }); }
      try { return Promise.resolve(apply()); } catch (cause) { if (starting) endEdit(); report(cause); return Promise.resolve(fallback); }
    }
    const handler = options.onEditRequest, request = { model };
    editMode = "requesting"; emit({ type: "edit-mode", mode: "requesting" });
    const operation = reserve("permission");
    return Promise.resolve().then(() => current(operation) && writable() ? handler(request, operation) : false).then(allowed => {
      if (!current(operation) || !writable()) return fallback;
      if (allowed !== true) throw new Error("他のユーザーが編集中のため変更できません。");
      editMode = "edit"; emit({ type: "edit-mode", mode: "edit" }); return apply();
    }).catch(cause => { if (current(operation)) { endEdit(); report(cause); } return fallback; }).finally(() => release(operation));
  }
  function execute(command: C | readonly C[], settings: ModelEditorExecuteOptions = {}): Promise<M | null> {
    if (!writable() || busy) return Promise.resolve(null);
    const commands = asCommands(command), before = model, beforeEpoch = epoch;
    let next: M, requirements: readonly F[];
    try {
      requirements = [...new Set(commands.flatMap(command => [...adapter.getCommandFeatures(command)]))];
      next = stage(commands);
      if (adapter.serialize(next) === modelJson) return Promise.resolve(null);
    } catch (cause) { report(cause); return Promise.resolve(null); }
    return permitted(() => {
      if (!writable() || model !== before || epoch !== beforeEpoch) return null;
      if (requirements.some(feature => !enabled(feature))) throw new Error("この機能は無効です。");
      return change(next, settings.source ?? "command", settings.historyGroup, requirements);
    }, null);
  }
  function replace(input: M): Promise<M | null> {
    if (!writable() || busy || !enabled("import")) return Promise.resolve(null);
    const before = model, beforeEpoch = epoch; let next: M;
    try { next = freeze(input); if (adapter.serialize(next) === modelJson) return Promise.resolve(null); } catch (cause) { report(cause); return Promise.resolve(null); }
    return permitted(() => { if (model !== before || epoch !== beforeEpoch || !writable() || !enabled("import")) throw new Error("読み込みを中止しました。"); return change(next, "import", undefined, adapter.features.includes("import" as F) ? ["import" as F] : []); }, null);
  }
  async function prepare(worker: (model: M, context: OperationContext) => Promise<C | readonly C[]>, settings: { feature?: F } = {}) {
    if (!writable() || busy || settings.feature && !enabled(settings.feature)) return null;
    const before = model, operation = reserve("prepare");
    try {
      const commands = await worker(before, operation);
      if (!current(operation) || !writable() || model !== before || settings.feature && !enabled(settings.feature)) return null;
      release(operation); return await execute(commands);
    } catch (cause) { if (current(operation)) report(cause); return null; } finally { release(operation); }
  }
  async function runTask(feature: F, worker: (context: ModelEditorTaskContext<M, C>) => Promise<void>): Promise<boolean> {
    if (!writable() || busy || !enabled(feature)) return false;
    const beforeEpoch = epoch, beforeModel = model;
    const allowed = await permitted(() => true, false);
    if (!allowed || epoch !== beforeEpoch || model !== beforeModel || !writable() || busy || !enabled(feature)) return false;
    const operation = reserve("task"), starting = model, group = `task:${operation.requestId}`;
    try {
      await worker({ ...operation, model: starting, apply(command, settings = {}) {
        if (!current(operation) || !writable() || !enabled(feature)) return null;
        const commands = asCommands(command), requirements = [feature, ...commands.flatMap(command => [...adapter.getCommandFeatures(command)])];
        return change(stage(commands), settings.source ?? "command", settings.historyGroup ?? group, requirements);
      } });
      return current(operation);
    } catch (cause) { if (current(operation)) report(cause); return false; } finally { release(operation); }
  }
  function history(direction: "undo" | "redo") {
    const source = direction === "undo" ? past : future, destination = direction === "undo" ? future : past;
    if (!source.length || !enabled("history") || source.at(-1)!.features.some(feature => !enabled(feature))) return Promise.resolve(false);
    const beforeEpoch = epoch;
    return permitted(() => {
      if (epoch !== beforeEpoch || !enabled("history") || source.at(-1)?.features.some(feature => !enabled(feature))) return false;
      const next = source.pop(); if (!next) return false;
      destination.push({ model, features: next.features }); model = next.model; modelJson = adapter.serialize(model); lastGroup = undefined; notice = null;
      publish(); safely(() => options.onChange?.(model)); emit({ type: "change", source: direction, model }); return true;
    }, false);
  }
  async function save() {
    if (!writable() || busy || !snapshot.dirty) return false;
    const operation = reserve("save"), saved = model, handler = options.onSave!;
    emit({ type: "save", phase: "start" });
    try {
      const allowed = await options.onBeforeSave?.(saved);
      if (!current(operation) || !writable()) return false;
      if (allowed === false) { emit({ type: "save", phase: "cancelled" }); return false; }
      const result = await handler(saved);
      if (!current(operation) || !writable()) return false;
      if (result !== undefined) change(freeze(result), "save");
      baseline = modelJson; baselineModel = model; lastGroup = undefined; endEdit();
      notice = { kind: "success", text: "保存しました。" }; publish(); emit({ type: "save", phase: "success" }); return true;
    } catch (cause) { if (current(operation)) { report(cause); emit({ type: "save", phase: "error", error: cause instanceof Error ? cause.message : "保存に失敗しました。" }); } return false; }
    finally { release(operation); }
  }
  return Object.freeze({
    getSnapshot: () => snapshot, getModel: () => model,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    configure(next: ModelEditorOptions<M, F>) {
      const oldOptions = options, previousFlags = JSON.stringify(flags), wasReadonly = readonly;
      options = next; flags = resolve(); readonly = isReadOnly();
      if (readonly !== wasReadonly || previousFlags !== JSON.stringify(flags)) { cancelPending(); endEdit(); publish(); }
      if (oldOptions.onDirtyChange !== options.onDirtyChange) safely(() => options.onDirtyChange?.(snapshot.dirty));
    },
    execute, replace, prepare, runTask, save, undo: () => history("undo"), redo: () => history("redo"), cancelPending, setNotice,
    discard() { if (!writable() || busy && busy !== "permission") return; cancelPending(); const changed = model !== baselineModel; model = baselineModel; modelJson = baseline; past.length = 0; future.length = 0; endEdit(); notice = null; publish(); if (changed) { safely(() => options.onChange?.(model)); emit({ type: "change", source: "discard", model }); } },
    activate() { alive = true; abort = new AbortController(); publish(); safely(() => options.onDirtyChange?.(snapshot.dirty)); },
    dispose() { alive = false; cancelPending(); editMode = "view"; },
  });
}
export type ModelEditorController<M, C, F extends string = string> = ReturnType<typeof createModelEditorController<M, C, F>>;
