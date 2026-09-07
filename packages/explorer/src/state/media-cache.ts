import type { ExplorerEntry } from "../model/draft";
import type { ExplorerFileReader } from "../model/file-content";

type Source = NonNullable<ExplorerEntry["source"]>;
type ObjectUrl = { value: string; users: number };
type CacheRecord = {
  source: Source;
  reader?: ExplorerFileReader;
  users: number;
  phase: "queued" | "pending" | "ready" | "cancelled";
  used: number;
  blob?: Blob;
  urls: Map<string, ObjectUrl>;
  promise: Promise<Blob>;
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
};

export type MediaLease = {
  promise: Promise<Blob>;
  readonly active: boolean;
  objectUrl: (mime?: string) => string;
  release: () => void;
};

export type MediaCacheOptions = {
  concurrency?: number;
  maxEntries?: number;
  maxBytes?: number;
};

/** Shared by one workspace. Active consumers pin content; only idle blobs are cached. */
export function createMediaCache({ concurrency = 4, maxEntries = 64, maxBytes = 32 * 1024 * 1024 }: MediaCacheOptions = {}) {
  const remote = new Map<ExplorerFileReader | undefined, Map<string, CacheRecord>>();
  const local = new WeakMap<File, CacheRecord>();
  const records = new Set<CacheRecord>();
  const activeUrls = new Set<string>();
  const listeners = new Set<() => void>();
  const queue: CacheRecord[] = [];
  let active = 0;
  let tick = 0;
  let scheduled = false;
  let revision = 0;
  let lastContentRevision: number | undefined;
  const limit = Math.max(1, concurrency);

  function revoke(url: string) {
    URL.revokeObjectURL(url);
    activeUrls.delete(url);
  }

  function forget(record: CacheRecord) {
    records.delete(record);
    if (record.source.kind === "local") local.delete(record.source.file);
    else {
      const bucket = remote.get(record.reader);
      bucket?.delete(record.source.id);
      if (!bucket?.size) remote.delete(record.reader);
    }
    for (const url of record.urls.values()) revoke(url.value);
    record.urls.clear();
    record.blob = undefined;
  }

  function cancel(record: CacheRecord) {
    if (record.phase === "cancelled") return;
    if (record.phase === "queued") {
      const index = queue.indexOf(record);
      if (index !== -1) queue.splice(index, 1);
    }
    record.phase = "cancelled";
    record.reject(new Error("ファイルの読み込みをキャンセルしました"));
    forget(record);
  }

  function trim() {
    let bytes = 0;
    for (const record of records) bytes += record.blob?.size ?? 0;
    const idle = [...records].filter(record => record.phase === "ready" && !record.users)
      .sort((a, b) => a.used - b.used);
    for (const record of idle) {
      if (records.size <= maxEntries && bytes <= maxBytes) break;
      bytes -= record.blob?.size ?? 0;
      forget(record);
    }
  }

  function pump() {
    scheduled = false;
    while (active < limit && queue.length) {
      const record = queue.shift()!;
      if (record.phase !== "queued") continue;
      record.phase = "pending";
      active++;
      void (async () => {
        try {
          const blob = record.source.kind === "local" ? record.source.file :
            record.reader ? await record.reader(record.source.id) :
              await Promise.reject(new Error("このファイルの読み込み方法が設定されていません"));
          if (record.phase === "cancelled") return;
          record.phase = "ready";
          record.blob = blob;
          record.used = ++tick;
          record.resolve(blob);
          // A ExplorerFileReader has no cancellation argument. Do not retain its result
          // if every consumer left while that already-started read was running.
          if (!record.users) forget(record);
          else trim();
        } catch (error) {
          if (record.phase !== "cancelled") {
            record.reject(error);
            forget(record);
          }
        } finally {
          active--;
          schedule();
        }
      })();
    }
  }

  function schedule() {
    if (scheduled || !queue.length) return;
    scheduled = true;
    queueMicrotask(pump);
  }

  function acquire(source: Source, reader?: ExplorerFileReader): MediaLease {
    // Renames, moves and cloned entry records do not change the content key.
    let record = source.kind === "local" ? local.get(source.file) : remote.get(reader)?.get(source.id);
    if (!record) {
      let resolve!: CacheRecord["resolve"];
      let reject!: CacheRecord["reject"];
      const promise = new Promise<Blob>((yes, no) => { resolve = yes; reject = no; });
      // A queued read can be released before a caller awaits it.
      void promise.catch(() => {});
      record = { source, reader, users: 0, phase: "queued", used: ++tick, urls: new Map(), promise, resolve, reject };
      records.add(record);
      if (source.kind === "local") local.set(source.file, record);
      else {
        let bucket = remote.get(reader);
        if (!bucket) remote.set(reader, bucket = new Map());
        bucket.set(source.id, record);
      }
      queue.push(record);
      schedule();
    }
    const owned = record;
    owned.users++;
    owned.used = ++tick;
    const urls = new Set<string>();
    let released = false;
    return {
      promise: owned.promise,
      get active() { return !released && owned.phase === "ready"; },
      objectUrl(mime = "") {
        if (released || owned.phase !== "ready" || !owned.blob) throw new Error("ファイルの読み込みが完了していません");
        const key = mime === owned.blob.type ? "" : mime;
        let url = owned.urls.get(key);
        if (!url) {
          const blob = key ? owned.blob.slice(0, owned.blob.size, key) : owned.blob;
          url = { value: URL.createObjectURL(blob), users: 0 };
          activeUrls.add(url.value);
          owned.urls.set(key, url);
        }
        if (!urls.has(key)) { urls.add(key); url.users++; }
        return url.value;
      },
      release() {
        if (released) return;
        released = true;
        owned.users--;
        owned.used = ++tick;
        for (const mime of urls) {
          const url = owned.urls.get(mime);
          if (url && !--url.users) { revoke(url.value); owned.urls.delete(mime); }
        }
        if (!owned.users && owned.phase === "queued") cancel(owned);
        else trim();
      },
    };
  }

  return {
    acquire,
    hasObjectUrl: (url: string) => activeUrls.has(url),
    getRevision: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    invalidateExisting(contentRevision?: number) {
      if (contentRevision !== undefined && contentRevision === lastContentRevision) return;
      lastContentRevision = contentRevision;
      for (const record of [...records]) if (record.source.kind === "existing") cancel(record);
      revision++;
      for (const listener of [...listeners]) listener();
    },
    // Reusable after disposal so React StrictMode can mount effects again.
    dispose() {
      for (const record of [...records]) cancel(record);
      queue.length = 0;
    },
  };
}

export type MediaCache = ReturnType<typeof createMediaCache>;
