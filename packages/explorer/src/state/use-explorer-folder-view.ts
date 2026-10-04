"use client";

import { useCallback, useEffect, useInsertionEffect, useLayoutEffect, useRef, useState } from "react";
import type { ExplorerFolderLoadOptions } from "../model/folder-loading";
import type { useExplorerDraft } from "./use-explorer-draft";

type Draft = ReturnType<typeof useExplorerDraft>;
/** Each pane owns cancellable leases; the shared draft deduplicates their requests. */
export function useExplorerFolderView(draft: Draft, folderIds: readonly string[], ownerDocument: Document | null) {
  const { loadFolder: load, getFolderLoadState, folderLoadingEnabled, folderLoadRevision } = draft;
  const leases = useRef(new Map<string, { controller: AbortController; pending: boolean; failed: boolean }>());
  const explicit = useRef(new Set<AbortController>());
  const mounted = useRef(true);
  const [interruptedIds, setInterruptedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [suspended, setSuspended] = useState(false);
  const [completionRevision, setCompletionRevision] = useState(0);
  const busy = draft.saving || draft.refreshing;
  const busyRef = useRef(busy);
  useInsertionEffect(() => { busyRef.current = busy; }, [busy]);
  const key = JSON.stringify([...new Set(folderIds)].sort());
  useLayoutEffect(() => {
    mounted.current = true;
    const abort = () => {
      for (const lease of leases.current.values()) lease.controller.abort();
      leases.current.clear();
      for (const controller of explicit.current) controller.abort();
      explicit.current.clear();
    };
    const hide = () => { abort(); setSuspended(true); };
    const show = () => { setSuspended(false); setCompletionRevision(value => value + 1); };
    const ownerWindow = folderLoadingEnabled ? ownerDocument?.defaultView : null;
    ownerWindow?.addEventListener?.("pagehide", hide);
    ownerWindow?.addEventListener?.("pageshow", show);
    return () => {
      mounted.current = false; abort();
      ownerWindow?.removeEventListener?.("pagehide", hide);
      ownerWindow?.removeEventListener?.("pageshow", show);
    };
  }, [ownerDocument, folderLoadingEnabled]);
  useEffect(() => {
    const wanted = new Set<string>(folderLoadingEnabled ? JSON.parse(key) : []);
    for (const [id, lease] of leases.current) if (!wanted.has(id)) { lease.controller.abort(); leases.current.delete(id); }
    if (busy) for (const [id, lease] of leases.current) if (!lease.pending) leases.current.delete(id);
    if (busy || suspended) return;
    for (const id of wanted) {
      const status = getFolderLoadState(id).status;
      // Errors require an explicit retry; cache changes must not cause retry loops.
      if (status === "loaded" || status === "error" || leases.current.get(id)?.pending || leases.current.get(id)?.failed) continue;
      const lease = { controller: new AbortController(), pending: true, failed: false };
      leases.current.set(id, lease);
      void load(id, { signal: lease.controller.signal }).catch(() => false).then(loaded => {
        lease.pending = false;
        if (!mounted.current || leases.current.get(id) !== lease || lease.controller.signal.aborted) return;
        if (!loaded && getFolderLoadState(id).status === "unloaded") {
          if (busyRef.current) leases.current.delete(id);
          else {
            lease.failed = true;
            setInterruptedIds(previous => new Set([...previous, id]));
          }
        }
        setCompletionRevision(value => value + 1);
      });
    }
  }, [key, folderLoadingEnabled, folderLoadRevision, load, getFolderLoadState, busy, suspended, completionRevision]);
  const loadFolder = useCallback(async (id: string, options: ExplorerFolderLoadOptions = {}) => {
    if (!mounted.current || options.signal?.aborted) return false;
    setInterruptedIds(previous => { if (!previous.has(id)) return previous; const next = new Set(previous); next.delete(id); return next; });
    const controller = new AbortController(), cancel = () => controller.abort();
    explicit.current.add(controller);
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const loaded = await load(id, { ...options, signal: controller.signal });
      if (!loaded && mounted.current && !controller.signal.aborted && getFolderLoadState(id).status === "unloaded")
        setInterruptedIds(previous => new Set([...previous, id]));
      return loaded;
    }
    finally { options.signal?.removeEventListener("abort", cancel); explicit.current.delete(controller); }
  }, [load, getFolderLoadState]);
  const readFolderState = useCallback((id: string) => {
    const state = getFolderLoadState(id);
    return state.status === "unloaded" && interruptedIds.has(id)
      ? { status: "error" as const, error: "読み込みが中止されました。再試行してください" } : state;
  }, [getFolderLoadState, interruptedIds]);
  return { loadFolder, getFolderLoadState: readFolderState, folderLoadRevision: folderLoadRevision + completionRevision };
}
