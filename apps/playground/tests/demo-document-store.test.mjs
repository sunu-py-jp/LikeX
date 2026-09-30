import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const output = await build({ entryPoints: [new URL("../src/ai/demo-document-store.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", write: false });
const { demoDocumentStore: store } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const payload = (title = "資料", kind = "slide") => ({ kind, title, document: JSON.stringify({ title, items: [1, 2] }), itemCount: 2 });

// A transaction-level browser double: requests are asynchronous, writes serialize,
// and their isolated changes are published only by commit. Tests can abort after
// request success, which catches the common IndexedDB premature-save bug.
function database(t) {
  const state = { records: new Map(), opens: 0, closed: 0, initialized: false, active: null, queue: [], commitError: null, requestError: null,
    openError: null, blocked: false, holdCommit: false, releaseCommit: null, resumeOpen: null };
  const schedule = () => {
    if (state.active || !state.queue.length) return;
    const next = state.queue.shift(); state.active = next; next.start();
  };
  const newTransaction = mode => {
    let working, ended = false, scheduled = false;
    const operations = [];
    const release = () => { state.active = null; schedule(); };
    const abort = error => {
      if (ended) return;
      ended = true; tx.error = error ?? null;
      setImmediate(() => { tx.onabort?.({ target: tx }); release(); });
    };
    const commit = () => {
      if (ended) return;
      if (mode === "readwrite" && state.commitError) { const error = state.commitError; state.commitError = null; abort(error); return; }
      ended = true; if (mode === "readwrite") state.records = working;
      tx.oncomplete?.({ target: tx }); release();
    };
    const step = () => {
      scheduled = false; if (ended || !working) return;
      const operation = operations.shift();
      if (operation) { operation(); wake(); }
      else if (mode === "readwrite" && state.holdCommit) { state.holdCommit = false; state.releaseCommit = commit; }
      else commit();
    };
    const wake = () => { if (!scheduled && !ended && working) { scheduled = true; setImmediate(step); } };
    const request = action => {
      const req = {};
      operations.push(() => {
        if (state.requestError) {
          req.error = state.requestError; state.requestError = null; tx.error = req.error;
          req.onerror?.({ target: req }); tx.onerror?.({ target: req }); abort(req.error); return;
        }
        try { req.result = action(); req.onsuccess?.({ target: req }); }
        catch (error) { req.error = error; tx.error = error; req.onerror?.({ target: req }); tx.onerror?.({ target: req }); abort(error); }
      }); wake(); return req;
    };
    const objectStore = {
      get: id => request(() => structuredClone(working.get(id))),
      add: record => request(() => { if (working.has(record.id)) throw new DOMException("Duplicate", "ConstraintError"); working.set(record.id, structuredClone(record)); return record.id; }),
      put: record => request(() => { working.set(record.id, structuredClone(record)); return record.id; }),
      index: () => ({ openCursor: kind => {
        const req = {}; let matches, offset = 0;
        const next = () => { operations.push(() => {
          matches ??= [...working].filter(([, value]) => value.kind === kind);
          const entry = matches[offset++];
          req.result = entry ? { primaryKey: entry[0], value: structuredClone(entry[1]), continue: next } : null;
          req.onsuccess?.({ target: req });
        }); wake(); };
        next(); return req;
      } }),
    };
    const tx = { error: null, objectStore: () => objectStore, abort: () => abort(),
      start() { working = new Map([...state.records].map(([id, value]) => [id, structuredClone(value)])); wake(); } };
    state.queue.push(tx); setImmediate(schedule); return tx;
  };
  const factory = { open() {
    state.opens++; const req = {};
    const finish = () => {
      if (state.openError) { req.error = state.openError; req.onerror?.({ target: req }); return; }
      const schema = { indexNames: { contains: () => false }, createIndex() {} };
      req.result = { objectStoreNames: { contains: () => state.initialized }, createObjectStore: () => schema,
        close() { state.closed++; }, transaction(_name, mode) { return newTransaction(mode); } };
      if (!state.initialized) { req.transaction = { objectStore: () => schema, abort() {} }; req.onupgradeneeded?.({ target: req }); state.initialized = true; }
      req.onsuccess?.({ target: req });
    };
    setImmediate(() => { if (state.blocked) { state.resumeOpen = finish; req.onblocked?.({ target: req }); } else finish(); }); return req;
  } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: factory });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else delete globalThis.indexedDB; });
  return state;
}

test("created and saved documents persist across connections; list filters kind, sorts updates and excludes contents", async t => {
  const db = database(t); let now = 100;
  t.mock.method(Date, "now", () => now++);
  const first = await store.create(payload("最初")), sheet = await store.create(payload("表", "spreadsheet")), second = await store.create(payload("最後"));
  assert.equal(first.revision, 1); assert.ok(first.id); assert.equal(first.createdAt, first.updatedAt);
  assert.deepEqual(await store.get(first.id), first);
  assert.deepEqual((await store.list("slide")).map(item => item.id), [second.id, first.id]);
  assert.deepEqual((await store.list("spreadsheet")).map(item => item.id), [sheet.id]);
  assert.equal(Object.hasOwn((await store.list("slide"))[0], "document"), false);
  const updated = await store.save({ id: first.id, expectedRevision: 1, ...payload("更新") });
  assert.equal(updated.revision, 2); assert.equal(updated.createdAt, first.createdAt); assert.equal(updated.kind, "slide");
  assert.deepEqual(await store.get(first.id), updated);
  assert.deepEqual((await store.list("slide")).map(item => item.id), [first.id, second.id]);
  updated.title = "Caller mutation";
  assert.equal((await store.get(first.id)).title, "更新");
  assert.equal(db.opens, db.closed);
});

test("concurrent saves from two tabs atomically accept one expected revision and reject the stale writer", async t => {
  database(t); const original = await store.create(payload());
  const results = await Promise.allSettled([
    store.save({ id: original.id, expectedRevision: 1, ...payload("Tab A") }),
    store.save({ id: original.id, expectedRevision: 1, ...payload("Tab B") }),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected").reason;
  assert.equal(rejected.name, "DemoDocumentConflictError"); assert.match(rejected.message, /別のタブ.*上書きしていません/);
  const winner = results.find(result => result.status === "fulfilled").value;
  assert.deepEqual(await store.get(original.id), winner); assert.equal(winner.revision, 2);
});

test("save promises wait for transaction completion after successful requests", async t => {
  const db = database(t); const original = await store.create(payload()); db.holdCommit = true;
  let settled = false;
  const pending = store.save({ id: original.id, expectedRevision: 1, ...payload("保存待ち") }).then(value => { settled = true; return value; });
  for (let i = 0; i < 20 && !db.releaseCommit; i++) await tick();
  assert.equal(typeof db.releaseCommit, "function"); assert.equal(settled, false); assert.equal(db.records.get(original.id).revision, 1);
  db.releaseCommit(); assert.equal((await pending).revision, 2); assert.equal(db.records.get(original.id).title, "保存待ち");
});

test("quota failure at final commit retains the previous record and reports a recoverable error", async t => {
  const db = database(t); const original = await store.create(payload());
  db.commitError = new DOMException("Full", "QuotaExceededError");
  await assert.rejects(store.save({ id: original.id, expectedRevision: 1, ...payload("失敗") }), /保存容量.*ファイルに書き出し/);
  assert.deepEqual(await store.get(original.id), original);
  db.commitError = new DOMException("Full", "QuotaExceededError");
  await assert.rejects(store.create(payload("作成失敗")), /保存容量/);
  assert.equal((await store.list("slide")).length, 1);
  assert.equal((await store.save({ id: original.id, expectedRevision: 1, ...payload("再試行") })).revision, 2);
});

test("missing documents are distinct from read errors and cannot be recreated by save", async t => {
  const db = database(t);
  assert.equal(await store.get("missing"), undefined);
  await assert.rejects(store.save({ id: "missing", expectedRevision: 1, ...payload() }), /保存先の資料が見つかりません/);
  db.requestError = new DOMException("Unavailable", "UnknownError");
  await assert.rejects(store.get("missing"), /読み込みに失敗.*再試行/);
  assert.equal(db.records.size, 0);
});

test("get and list reject corrupted metadata without deleting or changing any stored content", async t => {
  const db = database(t); const original = await store.create(payload());
  for (const patch of [{ revision: 0 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { createdAt: -1 }, { updatedAt: original.createdAt - 1 }, { updatedAt: Number.MAX_SAFE_INTEGER },
    { title: "x".repeat(1001) }, { itemCount: 1_000_001 }, { itemCount: 1.5 }, { document: null }, { id: "wrong-id" }]) {
    const invalid = { ...original, ...patch }; db.records.set(original.id, invalid);
    await assert.rejects(store.get(original.id), /保存データが正しくありません/);
    await assert.rejects(store.list("slide"), /保存データが正しくありません/);
    assert.deepEqual(db.records.get(original.id), invalid);
  }
});

test("invalid writes and oversized documents reject before opening storage", async t => {
  const db = database(t);
  for (const patch of [{ kind: "document" }, { title: "x".repeat(1001) }, { itemCount: -1 }, { itemCount: Infinity }, { document: "" },
    { document: "x".repeat(128 * 1024 * 1024 + 1) }]) await assert.rejects(store.create({ ...payload(), ...patch }), /保存データ/);
  await assert.rejects(store.save({ id: "a", expectedRevision: 0, ...payload() }), /保存データ/);
  await assert.rejects(store.get("\n"), /保存データ/);
  await assert.rejects(store.list("other"), /保存データ/);
  assert.equal(db.opens, 0); assert.equal(db.records.size, 0);
});

test("clock rollback still advances update order and revision without changing creation time", async t => {
  database(t); let now = 100;
  t.mock.method(Date, "now", () => now);
  const original = await store.create(payload()); now = 0;
  const result = await store.save({ id: original.id, expectedRevision: 1, ...payload("時間が戻った後") });
  assert.equal(result.updatedAt, 101); assert.equal(result.createdAt, 100); assert.equal(result.revision, 2);
});

test("unavailable, denied and blocked IndexedDB never pretend to save or use a fallback", async t => {
  const db = database(t);
  db.openError = new DOMException("Denied", "SecurityError");
  await assert.rejects(store.create(payload()), /保存領域.*設定.*再試行/);
  db.openError = null; db.blocked = true;
  await assert.rejects(store.list("slide"), /他のタブ.*閉じて.*再試行/);
  db.resumeOpen(); assert.equal(db.closed, 1, "a blocked open that later succeeds closes the abandoned connection");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  await assert.rejects(store.create(payload()), /IndexedDB.*ブラウザー/);
  assert.equal(db.records.size, 0);
});
