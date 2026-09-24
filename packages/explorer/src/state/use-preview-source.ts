"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ExplorerEntry } from "../model/draft";
import type { ExplorerFileReader } from "../model/file-content";
import type { ExplorerPreviewMode, ExplorerPreviewOptions, ExplorerPreviewRequest, ExplorerPreviewSource, ExplorerPreviewSourceResolver } from "../model/preview";
import { getPreviewFormat, inertPreviewMime, previewModeForMime, validatePreviewUrl } from "../model/preview-formats";
import { fileExtension } from "../model/text";
import { useMediaCache, useMediaRevision } from "./media-context";
import type { MediaLease } from "./media-cache";

const MAX_TEXT_BYTES = 1024 * 1024;
type Status = "loading" | "pending" | "unsupported" | "ready" | "error" | "tooLarge";
type Resolved = { target: object; source?: ExplorerPreviewSource; error?: string };
type ContentState = {
  key: object; status: Status; mode?: ExplorerPreviewMode; url?: string; text?: string; error?: string; mediaError?: boolean;
};

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "ファイルを読み込めませんでした"; }

export type PreviewSourceProps = {
  entry: ExplorerEntry;
  request?: ExplorerPreviewRequest;
  readFile?: ExplorerFileReader;
  resolvePreviewSource?: ExplorerPreviewSourceResolver;
  processing?: boolean;
  previewOptions?: ExplorerPreviewOptions;
};

/** Resolve descriptors separately from their bytes so changing closures never restarts a ready video. */
export function usePreviewSource({ entry, request: suppliedRequest, readFile, resolvePreviewSource, processing = false, previewOptions }: PreviewSourceProps) {
  const cache = useMediaCache();
  const file = entry.source?.kind === "local" ? entry.source.file : null;
  const sourceId = entry.source?.kind === "existing" ? entry.source.id : null;
  const source = useMemo<ExplorerEntry["source"]>(() => file ? { kind: "local", file } : sourceId !== null ? { kind: "existing", id: sourceId } : null, [file, sourceId]);
  const revision = useMediaRevision(cache, !file);
  const target = useMemo(() => ({ id: entry.id, source, revision }), [entry.id, source, revision]);
  const request = useMemo<ExplorerPreviewRequest | null>(() => suppliedRequest ?? (entry.kind === "file" ? {
    ...entry, kind: "file", source: source ? { ...source } : null, extension: fileExtension(entry.name), path: `/${entry.name}`,
  } : null), [entry, source, suppliedRequest]);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  useEffect(() => {
    if (!resolvePreviewSource || !request) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await resolvePreviewSource(request, { signal: controller.signal, processing });
        if (!controller.signal.aborted) setResolved({ target, source: result });
      } catch (error) {
        if (!controller.signal.aborted) setResolved({ target, error: errorMessage(error) });
      }
    })();
    return () => controller.abort();
  }, [target, request, resolvePreviewSource, processing]);

  const resolution = resolved?.target === target ? resolved : null;
  const custom = resolvePreviewSource ? resolution?.source : undefined;
  let mode: ExplorerPreviewMode | undefined, mime: string | undefined, failure = resolvePreviewSource ? resolution?.error : undefined;
  let status: Status = resolvePreviewSource && !resolution ? "loading" : "ready";
  let url: string | undefined;
  try {
    if (failure) status = "error";
    else if (custom?.kind === "pending") status = "pending";
    else if (custom?.kind === "url") {
      if (!["image", "video", "pdf"].includes(custom.mode)) throw new Error("直接URLのプレビュー形式が正しくありません");
      mode = custom.mode; url = validatePreviewUrl(custom.url);
    } else if (custom?.kind === "blob") {
      if (typeof custom.cacheKey !== "string" || !custom.cacheKey || typeof custom.mime !== "string" || typeof custom.read !== "function")
        throw new Error("BlobプレビューにはcacheKey、mime、readを指定してください");
      mode = inertPreviewMime(custom.mime) ? "text" : custom.mode ?? previewModeForMime(custom.mime) ?? getPreviewFormat(entry, previewOptions)?.mode;
      if (mode && !["image", "video", "pdf", "text"].includes(mode)) throw new Error("Blobのプレビュー形式が正しくありません");
      mime = custom.mime;
      if (!mode) status = "unsupported";
    } else if (status !== "loading" && !failure) {
      if (custom != null) throw new Error("プレビューソースが正しくありません");
      const format = getPreviewFormat(entry, previewOptions);
      if (format) { mode = format.mode; mime = format.mime; }
      else status = "unsupported";
      if (mode === "text" && entry.size > MAX_TEXT_BYTES) status = "tooLarge";
    }
  } catch (error) { status = "error"; failure = errorMessage(error); }
  const kind = custom?.kind ?? "raw";
  const cacheKey = custom?.kind === "blob" || custom?.kind === "url" ? custom.cacheKey : undefined;
  const reader = kind === "raw" && !file ? readFile : undefined;
  const crossOrigin = custom?.kind === "url" ? custom.crossOrigin : undefined;
  const pendingMessage = custom?.kind === "pending" ? custom.message : undefined;
  const [retry, setRetry] = useState(0);
  const key = useMemo(() => ({ target, status, kind, mode, mime, url, cacheKey, reader, failure, retry }), [target, status, kind, mode, mime, url, cacheKey, reader, failure, retry]);
  const [content, setContent] = useState<ContentState | null>(null);
  // `read` is deliberately not a content dependency: cacheKey defines byte identity.
  const blobRead = custom?.kind === "blob" ? custom.read : undefined;
  useEffect(() => {
    if (key.status !== "ready" || key.kind === "url") return;
    let cancelled = false;
    let lease: MediaLease | null = null;
    void (async () => {
      try {
        lease = key.kind === "blob" && blobRead ? cache.previewSources.acquire({ entryId: target.id, source: target.source, revision: target.revision, cacheKey: key.cacheKey! }, blobRead) :
          target.source ? cache.acquire(target.source, key.reader) : null;
        if (!lease) throw new Error("この項目にはファイルの内容がありません");
        const blob = await lease.promise;
        if (cancelled) return;
        // MIME overrides alone are not evidence that HTML/SVG bytes are safe documents.
        const header = await blob.slice(0, 512).text();
        if (cancelled) return;
        const inert = inertPreviewMime(blob.type) || /^\s*(?:\uFEFF)?\s*(?:<!doctype\s+html\b|<html\b|<svg\b|<\?xml[\s\S]*?<svg\b)/i.test(header);
        if (key.mode === "text" || inert) {
          if (blob.size > MAX_TEXT_BYTES) { setContent({ key, status: "tooLarge" }); lease.release(); return; }
          const text = await blob.text();
          if (!cancelled) setContent({ key, status: "ready", mode: "text", text });
        } else {
          if (key.mode === "pdf" && !header.startsWith("%PDF-")) throw new Error("このファイルは有効なPDFとして確認できませんでした。");
          setContent({ key, status: "ready", mode: key.mode, url: lease.objectUrl(key.mode === "pdf" ? "application/pdf" : key.mime) });
        }
      } catch (error) {
        lease?.release();
        if (!cancelled) setContent({ key, status: "error", error: errorMessage(error) });
      }
    })();
    return () => { cancelled = true; lease?.release(); };
    // A semantic descriptor, rather than its callback/object identity, owns this lease.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, key, target]);
  const current: ContentState = content?.key === key ? content : key.status === "ready" && key.kind === "url" ? { key, status: "ready", mode, url } :
    { key, status: key.status === "ready" ? "loading" : key.status, error: key.failure };
  const lastProcessing = useRef(processing);
  useEffect(() => {
    const wasProcessing = lastProcessing.current;
    lastProcessing.current = processing;
    if (wasProcessing && !processing && current.status === "error") {
      if (key.kind === "blob") cache.previewSources.discard({ entryId: target.id, source: target.source, revision: target.revision, cacheKey: key.cacheKey! });
      else if (key.kind === "raw" && target.source) cache.discard(target.source, key.reader);
      setRetry(value => value + 1);
    }
  }, [processing, current.status, cache, key, target]);
  return {
    ...current, crossOrigin, pendingMessage,
    status: processing && current.status === "error" ? "pending" as const : current.status,
    // A host can version bytes served at the same direct URL without changing the URL itself.
    mediaKey: kind === "url" ? cacheKey : undefined,
    mediaError: () => setContent({ key, status: "error", error: "このファイルを表示できませんでした。", mediaError: true }),
    isMediaError: current.mediaError,
  };
}
