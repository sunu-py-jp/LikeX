"use client";

import { useInsertionEffect, useLayoutEffect, useRef, useState } from "react";
import {
  createExplorerUploadSession,
  ExplorerUploadConflictError,
  ExplorerUploadValidationError,
  formatUploadRejections,
  type ExplorerUploadConflict,
  type ExplorerUploadDecision,
  type ExplorerUploadResult,
  type ExplorerUploadSession,
} from "../model/upload";
import type { ExplorerEntry } from "../model/draft";
import type { ExplorerEditIntent } from "../model/edit-session";
import type { useExplorerDraft } from "./use-explorer-draft";

type UploadOptions = {
  draft: ReturnType<typeof useExplorerDraft>;
  uploadFiles: boolean;
  uploadFolders: boolean;
  registerImport: (controller: AbortController) => () => void;
  cancelEditRequest: () => void;
  ownerDocument: Document | null;
  runEdit: (intent: ExplorerEditIntent, operation: () => boolean, onError: (error: unknown) => void) => boolean | Promise<boolean>;
  notify: (kind: "success" | "error" | "info", message: string, options?: { description?: string; persistent?: boolean }) => unknown;
};
type Batch = {
  files: File[];
  parent: string;
  directory: boolean;
  requiresFiles: boolean;
  controller: AbortController;
  unregister: () => void;
  session: ExplorerUploadSession;
  decisions: ExplorerUploadDecision[];
  applyAll: ExplorerUploadDecision["action"] | null;
  observedEntries: readonly ExplorerEntry[];
  applying: boolean;
};
export type ExplorerUploadPrompt = {
  conflict: ExplorerUploadConflict;
  conflictIndex: number;
  conflictCount: number;
  /** New prompts reset the checkbox, including a refreshed conflict after permission. */
  revision: number;
};

/** A batch is staged atomically, with confirmations local to its originating window. */
export function useExplorerUpload(options: UploadOptions) {
  const current = useRef(options);
  useInsertionEffect(() => { current.current = options; }, [options]);
  const mounted = useRef(true);
  const pending = useRef<Batch | null>(null);
  const revision = useRef(0);
  const [prompt, setPrompt] = useState<ExplorerUploadPrompt | null>(null);
  const [applying, setApplying] = useState(false);

  function alive(batch: Batch) {
    const latest = current.current;
    return mounted.current && pending.current === batch && !batch.controller.signal.aborted &&
      !latest.draft.readOnly && !latest.draft.saving && !latest.draft.refreshing && !latest.ownerDocument?.defaultView?.closed &&
      (!batch.directory || latest.uploadFolders) && (!batch.requiresFiles || latest.uploadFiles);
  }
  function release(batch: Batch) {
    batch.unregister();
    if (pending.current !== batch) return;
    pending.current = null;
    if (mounted.current) { setPrompt(null); setApplying(false); }
  }
  function cancel() {
    const batch = pending.current;
    if (!batch) return;
    batch.controller.abort();
  }
  useLayoutEffect(() => {
    mounted.current = true;
    const onClose = () => pending.current?.controller.abort();
    const view = options.ownerDocument?.defaultView;
    view?.addEventListener?.("pagehide", onClose);
    return () => {
      mounted.current = false;
      onClose();
      view?.removeEventListener?.("pagehide", onClose);
    };
  }, [options.ownerDocument]);
  useLayoutEffect(() => {
    const batch = pending.current;
    if (batch && !alive(batch)) batch.controller.abort();
  });

  function showConflict(batch: Batch, error: ExplorerUploadConflictError) {
    batch.applying = false;
    setApplying(false);
    setPrompt({ conflict: error.conflict, conflictIndex: error.conflictIndex, conflictCount: error.conflictCount, revision: ++revision.current });
  }
  function report(result: ExplorerUploadResult) {
    const parts = [
      result.addedCount ? `${result.addedCount}ファイルを追加` : "",
      result.overwrittenCount ? `${result.overwrittenCount}ファイルを上書き` : "",
      result.skippedCount ? `${result.skippedCount}ファイルの上書きをスキップ` : "",
      result.rejections.length ? `${result.rejections.length}ファイルを除外` : "",
    ].filter(Boolean);
    if (!parts.length) return;
    current.current.notify(result.skippedCount || result.rejections.length ? "info" : "success", `${parts.join("、")}しました`, {
      description: result.rejections.length ? formatUploadRejections(result.rejections)
        : result.addedCount || result.overwrittenCount ? "保存するまで、変更はこの画面で保持されます" : undefined,
      persistent: result.rejections.length > 0,
    });
  }
  function fail(batch: Batch, error: unknown) {
    if (!alive(batch)) { release(batch); return; }
    if (error instanceof ExplorerUploadConflictError) {
      // The edit gate or another window refreshed the target. Apply-all approval
      // never extends silently to a version the user has not seen.
      batch.applyAll = null;
      batch.observedEntries = current.current.draft.getEntries();
      showConflict(batch, error);
      return;
    }
    release(batch);
    if (error instanceof ExplorerUploadValidationError) {
      current.current.notify("error", `${error.rejections.length}ファイルが条件に合わないため、追加を中止しました`, {
        description: error.message, persistent: true,
      });
    } else current.current.notify("error", error instanceof Error ? error.message : "ファイルを追加できませんでした");
  }
  function process(batch: Batch): boolean | Promise<boolean> {
    if (!alive(batch)) { release(batch); return false; }
    const draft = current.current.draft;
    if (batch.observedEntries !== draft.getEntries()) {
      batch.applyAll = null;
      batch.observedEntries = draft.getEntries();
    }
    let prepared: ReturnType<typeof draft.prepareAdd>;
    // Rebuild from the original snapshot/Files and approved decisions. Nothing
    // from a partially answered batch is published to the shared workspace.
    for (;;) {
      try {
        prepared = draft.prepareAdd(batch.files, batch.parent, batch.decisions, batch.session);
        break;
      } catch (error) {
        if (error instanceof ExplorerUploadConflictError && batch.applyAll) {
          const unresolved = new Set(error.conflicts.map(conflict => conflict.fileIndex));
          batch.decisions = batch.decisions.filter(answer => !unresolved.has(answer.fileIndex));
          batch.decisions.push(...error.conflicts.map(conflict => ({
            fileIndex: conflict.fileIndex, existing: conflict.existing, action: batch.applyAll!,
          })));
        } else { fail(batch, error); return false; }
      }
    }
    if (!prepared) { release(batch); return false; }
    const commit = () => {
      if (!alive(batch)) { release(batch); return false; }
      const result = prepared.commit();
      if (!result) { release(batch); return false; }
      release(batch);
      report(result);
      return result.addedCount + result.overwrittenCount > 0;
    };
    try {
      if (!prepared.changed) return commit();
      batch.applying = true;
      setApplying(true);
      const result = current.current.runEdit({ action: "upload", parent: batch.parent }, commit, error => fail(batch, error));
      const finish = (changed: boolean) => {
        // Navigation or cancellation can invalidate authorization without an error.
        if (pending.current === batch && batch.applying) release(batch);
        return changed;
      };
      return typeof result === "boolean" ? finish(result) : result.then(finish);
    } catch (error) { fail(batch, error); return false; }
  }
  function start(files: readonly File[], parent: string, directory: boolean) {
    const latest = current.current;
    if (!files.length || pending.current || !mounted.current || latest.draft.readOnly || latest.draft.saving || latest.draft.refreshing ||
      latest.draft.editMode === "requesting" || !(directory ? latest.uploadFolders : latest.uploadFiles)) return false;
    const requiresFiles = !directory || (files.some(file => !!file.webkitRelativePath) && files.some(file => !file.webkitRelativePath));
    if (requiresFiles && !latest.uploadFiles) return false;
    const controller = new AbortController();
    const batch: Batch = {
      files: [...files], parent, directory, requiresFiles, controller,
      unregister: latest.registerImport(controller), session: createExplorerUploadSession(),
      decisions: [], applyAll: null, observedEntries: latest.draft.getEntries(), applying: false,
    };
    pending.current = batch;
    controller.signal.addEventListener("abort", () => {
      release(batch);
      current.current.cancelEditRequest();
    }, { once: true });
    return process(batch);
  }
  function answer(action: ExplorerUploadDecision["action"], applyToAll: boolean) {
    const batch = pending.current;
    if (!batch || !prompt || batch.applying || !alive(batch)) return false;
    const conflict = prompt.conflict;
    batch.decisions = batch.decisions.filter(item => item.fileIndex !== conflict.fileIndex);
    batch.decisions.push({ fileIndex: conflict.fileIndex, existing: conflict.existing, action });
    batch.applyAll = applyToAll ? action : null;
    return process(batch);
  }
  return { start, prompt, applying, answer, cancel };
}
