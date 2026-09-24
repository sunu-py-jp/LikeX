import type { ExplorerEntry } from "../model/draft";
import type { ExplorerPreviewSource } from "../model/preview";
import type { MediaCacheOptions, MediaLease } from "./media-cache";

type BlobSource = Extract<ExplorerPreviewSource, { kind: "blob" }>;
type Identity = { entryId: string; source: ExplorerEntry["source"]; revision: number; cacheKey: string };
function identityKey(identity: Identity) {
  return JSON.stringify([identity.entryId, identity.source?.kind ?? null,
    identity.source?.kind === "existing" ? identity.source.id : null, identity.revision, identity.cacheKey]);
}
type RecordState = {
  identity: Identity; bucket: Map<string, RecordState>; key: string; users: number; used: number;
  phase: "queued" | "pending" | "ready" | "cancelled";
  controller: AbortController; read: BlobSource["read"]; blob?: Blob;
  urls: Map<string, { value: string; users: number }>;
  promise: Promise<Blob>; resolve: (blob: Blob) => void; reject: (error: unknown) => void;
};

function abortError() { const error = new Error("プレビューの読み込みをキャンセルしました"); error.name = "AbortError"; return error; }

/** A separate workspace cache: preview variants never replace original download/thumbnail bytes. */
export function createPreviewSourceCache({ concurrency = 4, maxEntries = 64, maxBytes = 32 * 1024 * 1024 }: MediaCacheOptions = {}) {
  const remote = new Map<string, RecordState>();
  const local = new WeakMap<File, Map<string, RecordState>>();
  const records = new Set<RecordState>();
  const queue: RecordState[] = [];
  let active = 0, tick = 0, scheduled = false;
  const limit = Math.max(1, concurrency);

  function detach(record: RecordState) {
    if (record.bucket.get(record.key) === record) record.bucket.delete(record.key);
  }
  function forget(record: RecordState) {
    detach(record); records.delete(record);
    // Active URLs stay owned by their leases, including during invalidation.
    if (!record.users) {
      for (const url of record.urls.values()) URL.revokeObjectURL(url.value);
      record.urls.clear(); record.blob = undefined;
    }
  }
  function cancel(record: RecordState) {
    if (record.phase === "cancelled") return;
    record.phase = "cancelled";
    record.controller.abort(); record.reject(abortError()); forget(record);
  }
  function trim() {
    let bytes = [...records].reduce((sum, record) => sum + (record.blob?.size ?? 0), 0);
    for (const record of [...records].filter(record => !record.users && record.phase === "ready").sort((a, b) => a.used - b.used)) {
      if (records.size <= maxEntries && bytes <= maxBytes) break;
      bytes -= record.blob?.size ?? 0; forget(record);
    }
  }
  async function read(record: RecordState) {
    const signal = record.controller.signal;
    let stop!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      stop = () => reject(abortError()); signal.addEventListener("abort", stop, { once: true });
    });
    try {
      const blob = await Promise.race([Promise.resolve().then(() => {
        if (signal.aborted) throw abortError();
        return record.read({ signal });
      }), aborted]);
      if (signal.aborted) return;
      // Detached windows can supply a Blob from a different JavaScript realm.
      if (!blob || !["[object Blob]", "[object File]"].includes(Object.prototype.toString.call(blob)) ||
        typeof blob.slice !== "function" || typeof blob.text !== "function" || typeof blob.size !== "number")
        throw new Error("プレビューのreadはBlobを返す必要があります");
      record.blob = blob; record.phase = "ready"; record.used = ++tick; record.resolve(blob); trim();
    } catch (error) {
      if (!signal.aborted) { record.reject(error); forget(record); }
    } finally { signal.removeEventListener("abort", stop); active--; schedule(); }
  }
  function pump() {
    scheduled = false;
    while (active < limit && queue.length) {
      const record = queue.shift()!;
      if (record.phase !== "queued") continue;
      record.phase = "pending"; active++; void read(record);
    }
  }
  function schedule() {
    if (scheduled || !queue.length) return;
    scheduled = true; queueMicrotask(pump);
  }
  function acquire(identity: Identity, reader: BlobSource["read"]): MediaLease {
    let bucket = remote;
    if (identity.source?.kind === "local") {
      const file = identity.source.file;
      bucket = local.get(file) ?? new Map(); local.set(file, bucket);
    }
    const key = identityKey(identity);
    let record = bucket.get(key);
    if (!record) {
      let resolve!: RecordState["resolve"], reject!: RecordState["reject"];
      const promise = new Promise<Blob>((yes, no) => { resolve = yes; reject = no; });
      void promise.catch(() => {});
      record = { identity, bucket, key, users: 0, used: ++tick, phase: "queued", controller: new AbortController(), read: reader, urls: new Map(), promise, resolve, reject };
      bucket.set(key, record); records.add(record); queue.push(record); schedule();
    }
    const owned = record, urls = new Set<string>();
    owned.users++; owned.used = ++tick;
    let released = false;
    return {
      promise: owned.promise,
      get active() { return !released && owned.phase === "ready"; },
      objectUrl(mime = "") {
        if (released || owned.phase !== "ready" || !owned.blob) throw new Error("プレビューの読み込みが完了していません");
        const key = mime === owned.blob.type ? "" : mime;
        let url = owned.urls.get(key);
        if (!url) {
          url = { value: URL.createObjectURL(key ? owned.blob.slice(0, owned.blob.size, key) : owned.blob), users: 0 };
          owned.urls.set(key, url);
        }
        if (!urls.has(key)) { urls.add(key); url.users++; }
        return url.value;
      },
      release() {
        if (released) return;
        released = true; owned.users--; owned.used = ++tick;
        for (const key of urls) {
          const url = owned.urls.get(key);
          if (url && !--url.users) { URL.revokeObjectURL(url.value); owned.urls.delete(key); }
        }
        if (!owned.users && (owned.phase === "queued" || owned.phase === "pending")) cancel(owned);
        else if (!owned.users && owned.phase === "cancelled") forget(owned);
        else trim();
      },
    };
  }
  return {
    acquire,
    discard(identity: Identity) {
      const bucket = identity.source?.kind === "local" ? local.get(identity.source.file) : remote;
      const record = bucket?.get(identityKey(identity));
      if (record) forget(record);
    },
    invalidateExisting() { for (const record of [...records]) if (record.identity.source?.kind !== "local") cancel(record); },
    dispose() { for (const record of [...records]) cancel(record); queue.length = 0; },
  };
}
