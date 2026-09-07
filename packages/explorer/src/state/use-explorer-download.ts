"use client";

import { useInsertionEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { ExplorerEntry } from "../model/draft";
import type { ExplorerViewEvent } from "../model/events";
import type { ExplorerFileReader } from "../model/file-content";
import { readEntryFile } from "../model/file-content";
import { createFolderArchive } from "../model/archive";
import { describeEntry } from "../model/item-info";
import { getEntryIndex } from "../model/entry-index";
import { cloneDownloadRequest, createDownloadItems, type ExplorerDownloadHandler, type ExplorerDownloadProgress, type ExplorerDownloadResult } from "../model/download";
import type { DownloadManager } from "./download-manager";
import type { ExplorerNotification } from "./view-state";

const phases = { accepted: 1, preparing: 2, ready: 3, transferring: 4 } as const;
const progressLabels: Record<ExplorerDownloadProgress["phase"], string> = {
  accepted: "ダウンロードリクエストを受け付けました",
  preparing: "ダウンロードの準備をしています",
  ready: "ダウンロードの準備ができました",
  transferring: "ファイルを取得しています",
};

type Options = {
  entries: readonly ExplorerEntry[];
  enabled: boolean;
  readFile?: ExplorerFileReader;
  onDownloadRequest?: ExplorerDownloadHandler;
  manager: DownloadManager;
  windowId: string;
  ownerDocument: Document | null;
  emitEvent: (event: ExplorerViewEvent) => void;
  setNotification: Dispatch<SetStateAction<ExplorerNotification | null>>;
};

/** Download lifecycle only. Authentication, jobs and transport remain host-owned. */
export function useExplorerDownload(options: Options) {
  const current = useRef(options);
  useInsertionEffect(() => { current.current = options; }, [options]);
  const mounted = useRef(true);
  const { manager, windowId, enabled, ownerDocument } = options;
  useLayoutEffect(() => {
    mounted.current = true;
    const ownerWindow = ownerDocument?.defaultView;
    const close = () => manager.cancelWindow(windowId, "window-closed");
    ownerWindow?.addEventListener?.("pagehide", close);
    return () => {
      mounted.current = false;
      ownerWindow?.removeEventListener?.("pagehide", close);
      close();
    };
  }, [manager, windowId, ownerDocument]);
  useLayoutEffect(() => {
    if (!enabled) manager.cancelWindow(windowId, "disabled");
  }, [enabled, manager, windowId]);

  return async function download(entry: Pick<ExplorerEntry, "id">): Promise<void> {
    const start = current.current;
    if (!mounted.current || !start.enabled || start.ownerDocument?.defaultView?.closed) return;
    const target = getEntryIndex(start.entries).byId.get(entry.id);
    if (!target) return;
    const lease = manager.begin(target.id, windowId);
    if (!lease) return;
    const request = describeEntry(start.entries, target);
    const external = !!start.onDownloadRequest;
    const common = { requestId: lease.requestId, external };
    const emit = (event: ExplorerViewEvent) => current.current.emitEvent(event);
    const active = () => {
      if (start.ownerDocument?.defaultView?.closed) {
        manager.cancelWindow(windowId, "window-closed");
        return false;
      }
      return mounted.current && current.current.enabled && lease.isActive();
    };
    const eventRequest = () => cloneDownloadRequest(request);
    const notice = (kind: ExplorerNotification["kind"], message: string, persistent = false) => {
      if (!mounted.current) return;
      start.setNotification(previous => previous?.downloadRequestId === lease.requestId
        ? { kind, message, description: request.name, persistent, downloadRequestId: lease.requestId }
        : previous);
    };
    start.setNotification({ kind: "info", message: external ? "ダウンロードをリクエストしています" : "ダウンロードの準備をしています",
      description: request.name, persistent: true, downloadRequestId: lease.requestId });

    const cancelled = Symbol("cancelled");
    let releaseWait!: (value: typeof cancelled) => void;
    const cancellation = new Promise<typeof cancelled>(resolve => { releaseWait = resolve; });
    const emitCancelled = (reason: string, message = "ダウンロードを中止しました") => {
      emit({ type: "download-cancelled", ...common, request: eventRequest(), reason, message });
      if (reason === "disabled" && mounted.current)
        start.setNotification(previous => previous?.downloadRequestId === lease.requestId ? null : previous);
      else if (reason !== "unmounted" && reason !== "window-closed") notice("info", message);
    };
    const onAbort = () => {
      emitCancelled(typeof lease.signal.reason === "string" ? lease.signal.reason : "cancelled");
      releaseWait(cancelled);
    };
    lease.signal.addEventListener("abort", onAbort, { once: true });
    let lastProgress: ExplorerDownloadProgress | undefined;
    const reportProgress = (value: ExplorerDownloadProgress) => {
      if (!active()) return;
      if (!value || !Object.hasOwn(phases, value.phase) ||
        (value.message !== undefined && typeof value.message !== "string"))
        throw new Error("ダウンロードの進捗が正しくありません");
      const progress: ExplorerDownloadProgress = { phase: value.phase, ...(value.message !== undefined ? { message: value.message } : {}) };
      if (lastProgress && (phases[progress.phase] < phases[lastProgress.phase] ||
        (progress.phase === lastProgress.phase && progress.message === lastProgress.message))) return;
      lastProgress = progress;
      notice("info", progress.message ?? progressLabels[progress.phase], true);
      emit({ type: "download-progress", ...common, request: eventRequest(), progress: { ...progress } });
    };
    try {
      emit({ type: "download", status: "start", ...common, request: eventRequest() });
      if (!active()) return;
      // Invoke synchronously with the user gesture. Waiting for server jobs is
      // entirely inside the host promise; no fixed timeout is imposed here.
      const run = async (): Promise<ExplorerDownloadResult> => {
        if (start.onDownloadRequest) {
          return start.onDownloadRequest(cloneDownloadRequest(request), {
            requestId: lease.requestId, windowId, ownerDocument: start.ownerDocument, signal: lease.signal,
            items: createDownloadItems(start.entries, target.id), reportProgress,
          });
        }
        const blob = target.kind === "folder"
          ? await createFolderArchive(start.entries, target.id, start.readFile, lease.signal)
          : await readEntryFile(target, start.readFile);
        if (!active()) return { status: "cancelled" };
        const owner = start.ownerDocument;
        if (!owner) throw new Error("ダウンロードを開始する画面が見つかりません");
        const url = URL.createObjectURL(blob);
        const anchor = owner.createElement("a");
        try {
          anchor.href = url;
          anchor.download = target.kind === "folder" ? `${request.name}.zip` : request.name;
          owner.body.appendChild(anchor);
          anchor.click();
        } finally {
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        return { status: "handed-off" };
      };
      const result = await Promise.race([run(), cancellation]);
      if (result === cancelled || !active()) return;
      if (!result || !["handed-off", "completed", "cancelled"].includes(result.status) ||
        (result.message !== undefined && typeof result.message !== "string"))
        throw new Error("ダウンロード処理の結果が返されませんでした");
      // Capture only public fields; a URL/token accidentally returned by the
      // host must not become a lifecycle event or notification.
      const terminal: ExplorerDownloadResult = { status: result.status, ...(result.message !== undefined ? { message: result.message } : {}) };
      if (!lease.finish()) return;
      if (terminal.status === "cancelled") {
        emitCancelled("cancelled", terminal.message);
      } else {
        notice(terminal.status === "completed" ? "success" : "info", terminal.message ??
          (terminal.status === "completed" ? "ダウンロードが完了しました" : "ダウンロードの開始をブラウザーに依頼しました"));
        emit({ type: "download", status: "success", ...common, request: eventRequest(), result: { ...terminal, status: terminal.status } });
      }
    } catch (error) {
      if (!active() || !lease.finish()) return;
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
        emitCancelled("cancelled");
      } else {
        const message = error instanceof Error && error.message ? error.message : "ダウンロードに失敗しました";
        notice("error", "ダウンロードに失敗しました", true);
        // The host should throw a display-safe message; raw server errors stay
        // in its own logging boundary.
        start.setNotification(previous => previous?.downloadRequestId === lease.requestId ? { ...previous, description: message } : previous);
        emit({ type: "download", status: "error", ...common, request: eventRequest(), message });
      }
    } finally {
      lease.signal.removeEventListener("abort", onAbort);
      lease.finish();
    }
  };
}
