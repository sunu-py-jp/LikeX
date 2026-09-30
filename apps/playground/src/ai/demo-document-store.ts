export type DemoDocumentKind = "slide" | "spreadsheet";
export type DemoDocumentSummary = {
  id: string; kind: DemoDocumentKind; title: string; createdAt: number; updatedAt: number; revision: number; itemCount: number;
};
export type DemoDocumentRecord = DemoDocumentSummary & { document: string };
export interface DemoDocumentStore {
  list(kind: DemoDocumentKind): Promise<DemoDocumentSummary[]>;
  get(id: string): Promise<DemoDocumentRecord | undefined>;
  create(input: { kind: DemoDocumentKind; title: string; document: string; itemCount: number }): Promise<DemoDocumentRecord>;
  save(input: { id: string; expectedRevision: number; title: string; document: string; itemCount: number }): Promise<DemoDocumentRecord>;
}

const DATABASE = "likex-ai-demo-documents", VERSION = 1, RECORDS = "documents";
// The native Slide format accepts 80 Mi characters. Leave room for either demo's serialized document.
const MAX_DOCUMENT_LENGTH = 128 * 1024 * 1024;
const MAX_TITLE_LENGTH = 1000, MAX_ITEM_COUNT = 1_000_000;
class StoreError extends Error {}
const invalid = () => new StoreError("資料の保存データが正しくありません。元のファイルを確認してください。保存済みの内容は変更していません。");
function storageError(error: unknown): Error {
  if (error instanceof StoreError) return error;
  const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
  if (name === "QuotaExceededError") return new StoreError("ブラウザーの保存容量が不足しています。資料をファイルに書き出してから保存容量を確認し、再試行してください。");
  if (name === "SecurityError" || name === "NotAllowedError") return new StoreError("ブラウザーの保存領域を利用できません。サイトのデータ保存設定を確認し、再試行してください。");
  return new StoreError("資料の保存または読み込みに失敗しました。編集中の内容をファイルに書き出してから、ページを再読み込みして再試行してください。");
}
function kindOf(value: unknown): DemoDocumentKind { if (value !== "slide" && value !== "spreadsheet") throw invalid(); return value; }
function idOf(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) throw invalid();
  return value;
}
function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw invalid();
  return value;
}
function content(value: { title: unknown; document: unknown; itemCount: unknown }) {
  if (typeof value.title !== "string" || value.title.length > MAX_TITLE_LENGTH || typeof value.document !== "string" ||
    value.document.length === 0 || value.document.length > MAX_DOCUMENT_LENGTH) throw invalid();
  return { title: value.title, document: value.document, itemCount: integer(value.itemCount, 0, MAX_ITEM_COUNT) };
}
function recordOf(value: unknown): DemoDocumentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const raw = value as Record<string, unknown>;
  const fields = content({ title: raw.title, document: raw.document, itemCount: raw.itemCount });
  const createdAt = integer(raw.createdAt, 0, 8_640_000_000_000_000), updatedAt = integer(raw.updatedAt, createdAt, 8_640_000_000_000_000);
  return { id: idOf(raw.id), kind: kindOf(raw.kind), ...fields, createdAt, updatedAt, revision: integer(raw.revision, 1) };
}
function summaryOf(record: DemoDocumentRecord): DemoDocumentSummary {
  return { id: record.id, kind: record.kind, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt,
    revision: record.revision, itemCount: record.itemCount };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest, settled = false;
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(storageError(error)); } };
    try {
      if (!globalThis.indexedDB) throw new StoreError("このブラウザーでは資料を保存できません。IndexedDB を利用できるブラウザーで開いてください。");
      request = globalThis.indexedDB.open(DATABASE, VERSION);
    } catch (error) { fail(error); return; }
    request.onblocked = () => fail(new StoreError("資料の保存領域を開けません。他のタブで開いているプレイグラウンドを閉じてから、再試行してください。"));
    request.onerror = () => fail(request.error);
    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        const records = db.objectStoreNames.contains(RECORDS) ? request.transaction!.objectStore(RECORDS) : db.createObjectStore(RECORDS, { keyPath: "id" });
        if (!records.indexNames.contains("kind")) records.createIndex("kind", "kind");
      } catch (error) { fail(error); request.transaction?.abort(); }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A blocked open can finish later; it must not retain an unused connection.
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

/** A result is successful only after the transaction commits, including its final disk/quota checks. */
async function transaction<T>(mode: IDBTransactionMode, perform: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction, result: T, ready = false, failure: unknown;
    try { tx = db.transaction(RECORDS, mode); } catch (error) { db.close(); reject(storageError(error)); return; }
    tx.oncomplete = () => { db.close(); if (ready && !failure) resolve(result); else reject(storageError(failure)); };
    tx.onabort = () => { db.close(); reject(storageError(failure ?? tx.error)); };
    tx.onerror = () => { failure ??= tx.error; };
    const fail = (error: unknown) => { failure = error; tx.abort(); };
    try { perform(tx.objectStore(RECORDS), value => { result = value; ready = true; }, fail); }
    catch (error) { fail(error); }
  });
}

/** Browser-local persistence belongs to this demo host, never to the editor packages. */
export const demoDocumentStore: DemoDocumentStore = {
  async list(kind) {
    const expected = kindOf(kind);
    return transaction("readonly", (store, done, fail) => {
      const summaries: DemoDocumentSummary[] = [], request = store.index("kind").openCursor(expected);
      request.onsuccess = () => {
        try {
          const cursor = request.result;
          if (!cursor) { done(summaries.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))); return; }
          const record = recordOf(cursor.value);
          if (record.kind !== expected || record.id !== cursor.primaryKey) throw invalid();
          summaries.push(summaryOf(record)); cursor.continue();
        } catch (error) { fail(error); }
      };
    });
  },
  async get(id) {
    const key = idOf(id);
    return transaction("readonly", (store, done, fail) => {
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          if (request.result === undefined) { done(undefined); return; }
          const record = recordOf(request.result); if (record.id !== key) throw invalid(); done(record);
        } catch (error) { fail(error); }
      };
    });
  },
  async create(input) {
    const kind = kindOf(input.kind), fields = content(input), now = Date.now();
    const record = recordOf({ id: crypto.randomUUID(), kind, ...fields, createdAt: now, updatedAt: now, revision: 1 });
    return transaction("readwrite", (store, done) => { const request = store.add(record); request.onsuccess = () => done(record); });
  },
  async save(input) {
    const id = idOf(input.id), expectedRevision = integer(input.expectedRevision, 1), fields = content(input);
    return transaction("readwrite", (store, done, fail) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          if (request.result === undefined) throw new StoreError("保存先の資料が見つかりません。編集中の内容をファイルに書き出してから、資料一覧を開き直してください。");
          const current = recordOf(request.result);
          if (current.id !== id) throw invalid();
          if (current.revision !== expectedRevision) {
            const error = new StoreError("別のタブで資料が更新されています。上書きしていません。編集中の内容をファイルに書き出してから、資料一覧を開き直してください。");
            error.name = "DemoDocumentConflictError"; throw error;
          }
          const next = recordOf({ ...current, ...fields, revision: current.revision + 1, updatedAt: Math.max(Date.now(), current.updatedAt + 1) });
          const write = store.put(next); write.onsuccess = () => done(next);
        } catch (error) { fail(error); }
      };
    });
  },
};
