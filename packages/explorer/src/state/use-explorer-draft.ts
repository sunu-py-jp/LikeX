"use client";

import { useCallback, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addFilesWithResult,
  applyAction,
  createDraftSnapshot,
  getSavePayload,
  hasChanges,
  type ExplorerAction,
  type ExplorerEntry,
  type ExplorerSavePayload,
  type ExplorerSnapshot,
} from "../model/draft";
import {
  dispatchExplorerEvent,
  type ExplorerDraftEvent,
  type ExplorerEventHandler,
} from "../model/events";
import { describeEntries } from "../model/item-info";
import { formatExplorerPath } from "../model/path";
import type { ExplorerOptions } from "../model/config";
import { cloneUploadRejections, ExplorerUploadValidationError, formatUploadRejections, resolveUploadOptions, type ExplorerUploadDecision, type ExplorerUploadSession, createExplorerUploadSession, type ExplorerUploadOptions, type ExplorerUploadResult } from "../model/upload";
import { cloneEditRequest, createEditRequest, type ExplorerEditHandler, type ExplorerEditIntent, type ExplorerEditModeEvent, type ExplorerEditRequest, type ExplorerEditResult, type ExplorerEditState } from "../model/edit-session";
import type { SaveHandler as CoreSaveHandler, RefreshHandler as CoreRefreshHandler } from "../core";

export type ExplorerSaveHandler = CoreSaveHandler<ExplorerSavePayload, readonly ExplorerEntry[]>;

/** Retrieve the authoritative complete listing. Invoked only by an explicit refresh. */
export type ExplorerRefreshHandler = CoreRefreshHandler<readonly ExplorerEntry[]>;

/** @deprecated Use ExplorerSaveHandler. */
export type SaveHandler = ExplorerSaveHandler;
/** @deprecated Use ExplorerRefreshHandler. */
export type RefreshHandler = ExplorerRefreshHandler;

export type ExplorerDraftOptions = Pick<ExplorerOptions, "readOnly"> & {
  /** Read on mount only. Change the parent's key to load another workspace. */
  initialEntries: readonly ExplorerEntry[];
  /** Persistence belongs to the caller. Omission makes the draft read-only. Reject to retain unsaved changes. */
  onSave?: ExplorerSaveHandler;
  /** Replace the listing after retrieval succeeds. The low-level hook does not confirm discarding changes. */
  onRefresh?: ExplorerRefreshHandler;
  /** Acquire permission before the first edit. Omission permits local editing synchronously. */
  onEditRequest?: ExplorerEditHandler;
  onDirtyChange?: (dirty: boolean) => void;
  /** Observe completed operations without participating in persistence. */
  onEvent?: ExplorerEventHandler;
  /** Applied when importing local files or creating a new empty file. */
  upload?: ExplorerUploadOptions;
};

type DraftState = {
  baseline: ExplorerSnapshot;
  draft: ExplorerSnapshot;
  saving: boolean;
  saveError: string | null;
  refreshing: boolean;
  refreshError: string | null;
  contentRevision: number;
};

type EditSession = {
  requestId: string;
  request: ExplorerEditRequest;
  controller: AbortController;
  phase: "requesting" | "edit";
  cancelWait?: (allowed: boolean) => void;
};
type EditFinishReason = Exclude<ExplorerEditModeEvent["reason"], "request" | "granted">;

export function useExplorerDraft({
  initialEntries,
  onSave,
  onRefresh,
  onEditRequest,
  onDirtyChange,
  onEvent,
  upload,
  readOnly: requestedReadOnly,
}: ExplorerDraftOptions) {
  const readOnly = requestedReadOnly === true || onSave === undefined;
  const currentPolicy = useRef({ readOnly, onSave, onRefresh, onEditRequest });
  const uploadOptions = useMemo(() => resolveUploadOptions(upload), [upload]);
  const currentUploadOptions = useRef(uploadOptions);
  const [state, setState] = useState<DraftState>(() => {
    const snapshot = createDraftSnapshot(initialEntries);
    return { baseline: snapshot, draft: snapshot, saving: false, saveError: null,
      refreshing: false, refreshError: null, contentRevision: 0 };
  });
  // Keep synchronous operations ordered even before React renders the next frame.
  const current = useRef(state);
  const mounted = useRef(true);
  // Save and refresh are mutually exclusive and share the same effect lifetime.
  const persistenceRequest = useRef<object | null>(null);
  const observer = useRef(onEvent);
  const session = useRef<EditSession | null>(null);
  const endingEdit = useRef(0);
  const [editState, setEditState] = useState<ExplorerEditState>({ mode: "view", requestId: null, error: null, errorRequestId: null });
  const currentEditState = useRef(editState);
  const [editRevision, setEditRevision] = useState(0);
  const currentEditRevision = useRef(0);

  // Publish committed options before descendant layout effects can call retained
  // commands. This updates refs only; abandoned renders never change live policy.
  useInsertionEffect(() => {
    observer.current = onEvent;
    currentUploadOptions.current = uploadOptions;
    currentPolicy.current = { readOnly, onSave, onRefresh, onEditRequest };
  }, [onEvent, uploadOptions, readOnly, onSave, onRefresh, onEditRequest]);

  const publishEdit = useCallback((next: ExplorerEditState) => {
    currentEditState.current = next;
    if (mounted.current) setEditState(next);
  }, []);
  const emitEdit = useCallback((record: EditSession, mode: ExplorerEditState["mode"], reason: ExplorerEditModeEvent["reason"], message?: string) => {
    dispatchExplorerEvent(observer.current, { type: "edit-mode", mode, reason, requestId: record.requestId,
      request: cloneEditRequest(record.request), ...(message !== undefined ? { message } : {}) });
  }, []);
  const finishEdit = useCallback((reason: EditFinishReason, message?: string, expected = session.current) => {
    if (!expected || session.current !== expected) return false;
    endingEdit.current++;
    try {
      session.current = null;
      if (expected.phase === "edit") {
        currentEditRevision.current++;
        if (mounted.current) setEditRevision(currentEditRevision.current);
      }
      publishEdit({ mode: "view", requestId: null, error: message ?? null, errorRequestId: message !== undefined ? expected.requestId : null });
      expected.cancelWait?.(false);
      // Clear the session before synchronous abort listeners can re-enter.
      expected.controller.abort(reason);
      emitEdit(expected, "view", reason, message);
    } finally {
      endingEdit.current--;
    }
    return true;
  }, [publishEdit, emitEdit]);

  useLayoutEffect(() => {
    mounted.current = true;
    // StrictMode can clean up a session acquired by a descendant layout effect,
    // then reuse this hook state. Restore the released ref state in that setup.
    publishEdit(currentEditState.current);
    setEditRevision(currentEditRevision.current);
    setState(current.current);
    return () => {
      mounted.current = false;
      persistenceRequest.current = null;
      // React can reuse hook state after cleaning up its effects. A response
      // from the old lifetime must not retain a lock or overwrite newer edits.
      if (current.current.saving || current.current.refreshing)
        current.current = { ...current.current, saving: false, refreshing: false };
      finishEdit("unmounted");
    };
  }, [finishEdit, publishEdit]);
  useLayoutEffect(() => {
    if (readOnly) finishEdit("read-only");
  }, [readOnly, finishEdit]);

  const commit = useCallback((next: DraftState) => {
    if (!mounted.current) return;
    const previous = current.current;
    if (previous.draft === next.draft && previous.baseline === next.baseline &&
      previous.saving === next.saving && previous.saveError === next.saveError &&
      previous.refreshing === next.refreshing && previous.refreshError === next.refreshError &&
      previous.contentRevision === next.contentRevision) return;
    current.current = next;
    setState(next);
  }, []);

  const emit = useCallback((event: () => ExplorerDraftEvent) => {
    if (!mounted.current || !observer.current) return;
    dispatchExplorerEvent(observer.current, event());
  }, []);

  const emitChange = useCallback((
    action: ExplorerAction["action"] | "upload",
    previous: ExplorerSnapshot,
    next: ExplorerSnapshot,
  ) => {
    if (!observer.current || !hasChanges(previous, next)) return;
    emit(() => {
      const { changes } = getSavePayload(previous, next);
      return {
        type: "change",
        action,
        entries: describeEntries(next.entries),
        changes: {
          created: describeEntries(next.entries, changes.created),
          updated: describeEntries(next.entries, changes.updated),
          deleted: describeEntries(previous.entries, changes.deleted),
        },
      };
    });
  }, [emit]);

  const dirty = hasChanges(state.baseline, state.draft);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const getEntries = useCallback(() => current.current.draft.entries, []);
  const getEditRevision = useCallback(() => currentEditRevision.current, []);
  const getEditState = useCallback((): ExplorerEditState => {
    const latest = currentEditState.current;
    // Retained continuations can run in descendant layout effects before this
    // hook's own cleanup has released a newly prohibited session.
    if (!mounted.current || currentPolicy.current.readOnly)
      return { ...latest, mode: "view", requestId: null };
    return { ...latest };
  }, []);
  const requestEdit = useCallback((intent: ExplorerEditIntent): boolean | Promise<boolean> => {
    const policy = currentPolicy.current;
    if (!mounted.current || policy.readOnly || current.current.saving || current.current.refreshing || endingEdit.current) return false;
    if (session.current) return session.current.phase === "edit";
    let request: ExplorerEditRequest;
    try {
      request = createEditRequest(current.current.draft.entries, intent);
    } catch (error) {
      publishEdit({ mode: "view", requestId: null, error: error instanceof Error ? error.message : "編集する項目を確認できませんでした", errorRequestId: null });
      return false;
    }
    const record: EditSession = { requestId: crypto.randomUUID(), request, controller: new AbortController(),
      phase: policy.onEditRequest ? "requesting" : "edit" };
    session.current = record;
    const isCurrent = () => mounted.current && !currentPolicy.current.readOnly && session.current === record && !record.controller.signal.aborted;
    const reject = (error: unknown): false => {
      if (!isCurrent()) return false;
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
        finishEdit("cancelled", undefined, record);
      } else {
        const message = error instanceof Error && error.message ? error.message : "編集を開始できませんでした。もう一度お試しください。";
        finishEdit("error", message, record);
      }
      return false;
    };
    const allow = (result: ExplorerEditResult): boolean => {
      if (!isCurrent()) return false;
      try {
        if (result === false) {
          finishEdit("denied", "他のユーザーが編集中のため変更できません", record);
          return false;
        }
        if (result !== true && (!result || typeof result !== "object" || result.allowed !== true ||
          (result.entries !== undefined && !Array.isArray(result.entries))))
          throw new Error("編集許可の結果が正しくありません");
        if (typeof result === "object" && result.entries !== undefined) {
          const previous = current.current;
          if (hasChanges(previous.baseline, previous.draft))
            throw new Error("未保存の変更があるため、最新の一覧へ置き換えられません");
          const snapshot = createDraftSnapshot(result.entries);
          commit({ ...previous, baseline: snapshot, draft: snapshot, saveError: null, contentRevision: previous.contentRevision + 1 });
        }
        record.phase = "edit";
        record.cancelWait = undefined;
        publishEdit({ mode: "edit", requestId: record.requestId, error: null, errorRequestId: null });
        emitEdit(record, "edit", "granted");
        return isCurrent();
      } catch (error) {
        return reject(error);
      }
    };
    if (!policy.onEditRequest) return allow(true);
    publishEdit({ mode: "requesting", requestId: record.requestId, error: null, errorRequestId: null });
    const cancellation = new Promise<boolean>(resolve => { record.cancelWait = resolve; });
    emitEdit(record, "requesting", "request");
    if (!isCurrent()) return false;
    try {
      const result = policy.onEditRequest(cloneEditRequest(request), { requestId: record.requestId, signal: record.controller.signal });
      if (result && typeof result === "object" && "then" in result && typeof result.then === "function")
        return Promise.race([Promise.resolve(result).then(allow, reject), cancellation]);
      return allow(result as ExplorerEditResult);
    } catch (error) {
      return reject(error);
    }
  }, [commit, publishEdit, emitEdit, finishEdit]);

  const cancelEditRequest = useCallback((windowId?: string) => {
    const pending = session.current;
    if (pending?.phase === "requesting" && (windowId === undefined || pending.request.windowId === windowId))
      finishEdit("cancelled", undefined, pending);
  }, [finishEdit]);
  const endEdit = useCallback(() => {
    if (!mounted.current || endingEdit.current) return false;
    if (current.current.saving) throw new Error("保存が完了するまで操作をお待ちください");
    if (current.current.refreshing) throw new Error("再読み込みが完了するまで操作をお待ちください");
    if (hasChanges(current.current.baseline, current.current.draft))
      throw new Error("未保存の変更を保存または破棄してください");
    return finishEdit("ended");
  }, [finishEdit]);
  const requireEdit = useCallback((intent: ExplorerEditIntent) => {
    if (endingEdit.current) throw new Error("編集を開始してから変更してください");
    if (session.current?.phase === "edit") return;
    if (currentPolicy.current.onEditRequest || requestEdit(intent) !== true)
      throw new Error("編集を開始してから変更してください");
  }, [requestEdit]);

  const checkWritable = useCallback(() => {
    if (!mounted.current) return false;
    if (currentPolicy.current.readOnly)
      throw new Error("読み取り専用のため変更できません");
    if (current.current.saving)
      throw new Error("保存が完了するまで操作をお待ちください");
    if (current.current.refreshing)
      throw new Error("再読み込みが完了するまで操作をお待ちください");
    return true;
  }, []);

  /** Validate without acquiring permission; commit rechecks any refreshed baseline. */
  const prepareAction = useCallback((action: ExplorerAction): null | (() => boolean) => {
    if (!checkWritable()) return null;
    const command = { ...action, ...(action.ids ? { ids: [...action.ids] } : {}) };
    let source = current.current.draft;
    let options = currentUploadOptions.current;
    let candidate = applyAction(source, command, options);
    const refresh = () => {
      const latest = current.current.draft;
      const latestOptions = currentUploadOptions.current;
      if (latest !== source || latestOptions !== options) {
        candidate = applyAction(latest, command, latestOptions);
        source = latest;
        options = latestOptions;
      }
      return hasChanges(source, candidate);
    };
    if (!hasChanges(source, candidate)) return null;
    let completed = false;
    let committing = false;
    return () => {
      if (completed || committing || !checkWritable()) return false;
      committing = true;
      try {
        if (!refresh()) {
          completed = true;
          return false;
        }
        requireEdit(command);
        // A synchronous permission observer can also change the current draft.
        if (!checkWritable()) return false;
        if (!refresh()) {
          completed = true;
          return false;
        }
        const previous = current.current;
        completed = true;
        commit({ ...previous, draft: candidate, saveError: null });
        emitChange(command.action, previous.draft, candidate);
        return true;
      } finally {
        committing = false;
      }
    };
  }, [checkWritable, requireEdit, commit, emitChange]);

  /** Classify first; rejected/empty batches never need an edit session. */
  const prepareAdd = useCallback((files: readonly File[], parent: string, decisions: readonly ExplorerUploadDecision[] = [], uploadSession: ExplorerUploadSession = createExplorerUploadSession()): {
    result: ExplorerUploadResult;
    changed: boolean;
    commit: () => ExplorerUploadResult | undefined;
  } | undefined => {
    if (!checkWritable()) return;
    const captured = [...files];
    const answers = decisions.map(decision => ({ ...decision, existing: { ...decision.existing, source: decision.existing.source ? { ...decision.existing.source } : null } }));
    let source = current.current.draft;
    let options = currentUploadOptions.current;
    const stage = (snapshot: ExplorerSnapshot, upload: typeof options) => {
      try {
        return addFilesWithResult(snapshot, captured, parent, upload, answers, uploadSession);
      } catch (error) {
        if (error instanceof ExplorerUploadValidationError) {
          emit(() => ({
            type: "upload", status: "rejected", parentId: parent,
            parentPath: formatExplorerPath(snapshot.entries, parent),
            attemptedCount: captured.length, message: error.message,
            rejections: cloneUploadRejections(error.rejections),
          }));
        }
        throw error;
      }
    };
    let candidate = stage(source, options);
    const refresh = () => {
      const latest = current.current.draft;
      const latestOptions = currentUploadOptions.current;
      if (latest !== source || latestOptions !== options) {
        candidate = stage(latest, latestOptions);
        source = latest;
        options = latestOptions;
      }
    };
    let completed = false;
    let committing = false;
    return {
      changed: hasChanges(source, candidate.snapshot),
      result: { ...candidate.result, rejections: cloneUploadRejections(candidate.result.rejections) },
      commit: () => {
        if (completed || committing || !checkWritable()) return;
        committing = true;
        try {
          refresh();
          if (hasChanges(source, candidate.snapshot)) {
            requireEdit({ action: "upload", parent });
            if (!checkWritable()) return;
            refresh();
          }
          const { snapshot, result } = candidate;
          const previous = current.current;
          completed = true;
          if (hasChanges(previous.draft, snapshot)) {
            commit({ ...previous, draft: snapshot, saveError: null });
            emitChange("upload", previous.draft, snapshot);
          }
          if (result.rejections.length || result.skippedCount) {
            emit(() => ({
              type: "upload", status: "skipped", parentId: parent,
              parentPath: formatExplorerPath(source.entries, parent),
              attemptedCount: result.attemptedCount, addedCount: result.addedCount,
              overwrittenCount: result.overwrittenCount, skippedCount: result.skippedCount,
              rejections: cloneUploadRejections(result.rejections),
              message: [result.skippedCount ? `${result.skippedCount}ファイルの上書きをスキップしました` : "", formatUploadRejections(result.rejections)].filter(Boolean).join("\n"),
            }));
          }
          return { ...result, rejections: cloneUploadRejections(result.rejections) };
        } finally {
          committing = false;
        }
      },
    };
  }, [checkWritable, requireEdit, commit, emitChange, emit]);

  const apply = useCallback((action: ExplorerAction) => {
    prepareAction(action)?.();
  }, [prepareAction]);

  const add = useCallback((files: readonly File[], parent: string, decisions: readonly ExplorerUploadDecision[] = [], uploadSession?: ExplorerUploadSession): ExplorerUploadResult | undefined =>
    prepareAdd(files, parent, decisions, uploadSession)?.commit(), [prepareAdd]);

  const discard = useCallback(() => {
    if (!mounted.current) return;
    if (currentPolicy.current.readOnly)
      throw new Error("読み取り専用のため変更できません");
    const previous = current.current;
    if (previous.saving)
      throw new Error("保存が完了するまで操作をお待ちください");
    if (previous.refreshing)
      throw new Error("再読み込みが完了するまで操作をお待ちください");
    if (endingEdit.current) return;
    endingEdit.current++;
    try {
      const draft = previous.baseline;
      commit({ ...previous, draft, saveError: null });
      if (hasChanges(previous.draft, draft)) {
        emit(() => ({ type: "discard", entries: describeEntries(draft.entries) }));
      }
      finishEdit("discarded");
    } finally {
      endingEdit.current--;
    }
  }, [commit, emit, finishEdit]);

  const save = useCallback(async (windowId = "main"): Promise<boolean> => {
    if (!mounted.current) return false;
    if (currentPolicy.current.readOnly || currentPolicy.current.onSave === undefined ||
      current.current.saving || current.current.refreshing || endingEdit.current) return false;
    if (!hasChanges(current.current.baseline, current.current.draft)) {
      finishEdit("saved");
      return true;
    }
    if (session.current?.phase !== "edit") {
      const permission = requestEdit({ action: "save", windowId });
      const requestedId = session.current?.requestId;
      const allowed = typeof permission === "boolean" ? permission : await permission;
      if (!allowed || !requestedId || session.current?.requestId !== requestedId) return false;
    }
    const { readOnly, onSave: saveHandler } = currentPolicy.current;
    if (!mounted.current || readOnly || !saveHandler || endingEdit.current || current.current.saving || current.current.refreshing ||
      session.current?.phase !== "edit") return false;
    const previous = current.current;
    const savingSession = session.current;
    const request = {};
    persistenceRequest.current = request;
    const isCurrent = () => mounted.current && persistenceRequest.current === request;

    const snapshot = previous.draft;
    const payload = getSavePayload(previous.baseline, snapshot);
    // Set the lock before invoking user code, including synchronous callbacks.
    commit({ ...previous, saving: true, saveError: null });
    emit(() => ({
      type: "save",
      status: "start",
      payload: getSavePayload(previous.baseline, snapshot),
    }));
    try {
      if (!isCurrent()) return false;
      const persistedEntries = await saveHandler(payload);
      // The host may already have saved successfully after the view was torn
      // down. Preserve that result without changing a new lifetime's draft.
      if (!isCurrent()) return true;
      const persisted = createDraftSnapshot(
        typeof persistedEntries === "undefined"
          ? snapshot.entries
          : persistedEntries,
      );
      if (!isCurrent()) return true;
      endingEdit.current++;
      try {
        commit({ ...previous, baseline: persisted, draft: persisted, saving: false, saveError: null,
          contentRevision: previous.contentRevision + 1 });
        // Observers see persistence first, then the edit session is released.
        // Keep synchronous observer re-entry out of this completion boundary.
        emit(() => ({ type: "save", status: "success", entries: describeEntries(persisted.entries) }));
        finishEdit("saved", undefined, savingSession);
      } finally {
        endingEdit.current--;
      }
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      const message = error instanceof Error && error.message
        ? error.message
        : "保存できませんでした。もう一度お試しください。";
      commit({
        ...previous,
        saving: false,
        saveError: message,
      });
      emit(() => ({ type: "save", status: "error", message }));
      return false;
    } finally {
      if (persistenceRequest.current === request) persistenceRequest.current = null;
    }
  }, [commit, emit, finishEdit, requestEdit]);

  const refresh = useCallback(async (): Promise<boolean> => {
    const refreshHandler = currentPolicy.current.onRefresh;
    if (!mounted.current || typeof refreshHandler !== "function" || current.current.saving || current.current.refreshing ||
      session.current?.phase === "requesting" || endingEdit.current) return false;
    const previous = current.current;
    const previousSession = session.current;
    const request = {};
    persistenceRequest.current = request;
    const isCurrent = () => mounted.current && persistenceRequest.current === request;
    // Lock before observers or the host callback can synchronously re-enter.
    commit({ ...previous, refreshing: true, refreshError: null });
    emit(() => ({ type: "refresh", status: "start" }));
    if (!isCurrent()) return false;
    try {
      const entries = await refreshHandler();
      if (!isCurrent()) return false;
      if (!Array.isArray(entries)) throw new Error("再読み込みの結果が正しくありません");
      const snapshot = createDraftSnapshot(entries);
      if (!isCurrent()) return false;
      endingEdit.current++;
      try {
        const previousEditRevision = currentEditRevision.current;
        commit({ ...previous, baseline: snapshot, draft: snapshot, refreshing: false,
          saveError: null, refreshError: null, contentRevision: previous.contentRevision + 1 });
        // Publish the new listing before releasing the previous editing session.
        emit(() => ({ type: "refresh", status: "success", entries: describeEntries(snapshot.entries) }));
        if (isCurrent()) {
          finishEdit("refreshed", undefined, previousSession);
          // Even a read-only or already-clean workspace can retain clipboard,
          // dialogs or prepared commands that refer to the previous listing.
          if (currentEditRevision.current === previousEditRevision) {
            currentEditRevision.current++;
            setEditRevision(currentEditRevision.current);
          }
        }
      } finally {
        endingEdit.current--;
      }
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      const message = error instanceof Error && error.message
        ? error.message : "再読み込みできませんでした。もう一度お試しください。";
      commit({ ...previous, refreshing: false, refreshError: message });
      emit(() => ({ type: "refresh", status: "error", message }));
      return false;
    } finally {
      if (persistenceRequest.current === request) persistenceRequest.current = null;
    }
  }, [commit, emit, finishEdit]);

  return {
    readOnly,
    entries: state.draft.entries,
    dirty,
    saving: state.saving,
    saveError: state.saveError,
    refreshing: state.refreshing,
    refreshError: state.refreshError,
    canRefresh: typeof onRefresh === "function",
    contentRevision: state.contentRevision,
    uploadAccept: uploadOptions.accept,
    editMode: readOnly ? "view" as const : editState.mode,
    editRequestId: readOnly ? null : editState.requestId,
    editRevision,
    editError: editState.error,
    requestEdit,
    endEdit,
    cancelEditRequest,
    getEditState,
    getEditRevision,
    getEntries,
    prepareAction,
    prepareAdd,
    apply,
    add,
    save,
    refresh,
    discard,
  };
}
