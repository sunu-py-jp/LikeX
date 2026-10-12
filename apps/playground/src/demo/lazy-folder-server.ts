import { createSnapshot } from "@likex/explorer/model";
import { createTextSearchMatcher } from "@likex/core/text-search";
import type { ExplorerEntry, ExplorerSavePayload, ExplorerSearchBatch, ExplorerSearchConditions, ExplorerSearchPage, ExplorerSearchRequest } from "@likex/explorer";

const date = "2026-10-03T03:00:00.000Z";
const clone = (entry: ExplorerEntry): ExplorerEntry => ({ ...entry, source: entry.source && { ...entry.source } });
export const lazyDemoSalesId = "lazy-sales";
export const lazySearchExample = "^00[12]_機能仕様";
export const lazySearchPageExample = "機能仕様";

/** An in-memory server: its full index is deliberately not passed to Explorer. */
export function createLazyFolderServer() {
  let entries = new Map<string, ExplorerEntry>(), bodies = new Map<string, Blob>();
  const folder = (id: string, name: string, parent: string) => entries.set(id, { id, name, parent, kind: "folder", size: 0, mime: "", createdAt: date, updatedAt: date, favorite: 0, source: null });
  const file = (id: string, name: string, parent: string, text: string) => {
    const body = new Blob([text], { type: "text/markdown" });
    bodies.set(id, body);
    entries.set(id, { id, name, parent, kind: "file", size: body.size, mime: body.type, createdAt: date, updatedAt: date, favorite: 0, source: { kind: "existing", id } });
  };
  for (const [id, name] of [[lazyDemoSalesId, "営業資料"], ["lazy-development", "開発資料"]]) {
    folder(id, name, "root");
    for (const year of [2026, 2025]) {
      const yearId = `${id}-${year}`;
      folder(yearId, `${year}年度`, id);
      for (const [customer, label] of [["shinonome", "東雲製作所"], ["aoba", "青葉商事"]]) {
        const customerId = `${yearId}-${customer}`;
        folder(customerId, label, yearId);
        for (let index = 1; index <= 320; index++) {
          const title = `${String(index).padStart(3, "0")}_${name === "営業資料" ? "商談記録" : "機能仕様"}.md`;
          file(`${customerId}-${index}`, title, customerId, `# ${label} ${title}\n\n${year}年度の架空の業務資料です。フォルダを開いたときだけメタデータを取得します。\n`);
        }
      }
    }
  }
  folder("lazy-empty", "空のフォルダ", "root");
  file("lazy-readme", "このデモについて.md", "root", "# フォルダ単位の読み込み\n\n営業資料 → 2026年度 → 東雲製作所を開くと、320件のファイルを初めて読み込みます。戻って開き直しても再取得しません。\n変更後の保存は差分だけをサーバーへ反映します。未取得の資料は削除されません。\n");
  entries = new Map(createSnapshot([...entries.values()]).entries.map(entry => [entry.id, entry]));

  function list(folderId: string): ExplorerEntry[] {
    if (folderId !== "root" && entries.get(folderId)?.kind !== "folder") throw new Error("指定したフォルダがありません。");
    return [...entries.values()].filter(entry => entry.parent === folderId).map(clone);
  }
  function findMatches(query: string, conditions: ExplorerSearchConditions) {
    if (!query.trim()) return [];
    const matcher = createTextSearchMatcher({ text: query.trim(), matchCase: conditions.matchCase, wholeText: conditions.wholeName, useRegex: conditions.useRegex });
    return [...entries.values()].filter(entry => matcher.test(entry.name));
  }
  function makeSearchBatch(index: ReadonlyMap<string, ExplorerEntry>, matches: readonly ExplorerEntry[], sent = new Set<string>()): ExplorerSearchBatch {
    const metadata: ExplorerEntry[] = [];
    const hits = matches.map(entry => {
      const chain: ExplorerEntry[] = [];
      let current: ExplorerEntry | undefined = entry;
      while (current) { chain.unshift(current); current = index.get(current.parent); }
      for (const item of chain) if (!sent.has(item.id)) { sent.add(item.id); metadata.push(clone(item)); }
      return { entryId: entry.id };
    });
    return { hits, entries: metadata };
  }
  // Cursor state belongs to the server. Each session keeps its initial ranking/tree,
  // so later edits cannot shift page boundaries and retries return the same page.
  type SearchSession = { key: string; matches: ExplorerEntry[]; index: ReadonlyMap<string, ExplorerEntry> };
  const cursors = new Map<string, { session: SearchSession; offset: number }>();
  let nextSessionId = 0;
  async function searchPage(request: Pick<ExplorerSearchRequest, "query" | "conditions" | "cursor" | "limit">, signal: AbortSignal,
    wait: (signal: AbortSignal) => Promise<void> = waitForLazyFolder): Promise<ExplorerSearchPage> {
    signal.throwIfAborted();
    const key = JSON.stringify([request.query.trim(), request.conditions.matchCase, request.conditions.wholeName, request.conditions.useRegex]);
    const previous = request.cursor == null ? undefined : cursors.get(request.cursor);
    if (request.cursor != null && (!previous || previous.session.key !== key)) throw new Error("検索の続きが見つかりません。最初から検索してください。");
    const limit = Number.isFinite(request.limit) ? Math.min(1000, Math.max(1, Math.trunc(request.limit!))) : 100;
    const session = previous?.session ?? { key, matches: findMatches(request.query, request.conditions), index: entries };
    const offset = previous?.offset ?? 0;
    await wait(signal);
    signal.throwIfAborted();
    const end = offset + limit;
    const nextCursor = end < session.matches.length ? `lazy-search-${++nextSessionId}` : null;
    if (nextCursor) cursors.set(nextCursor, { session, offset: end });
    return { ...makeSearchBatch(session.index, session.matches.slice(offset, end)), nextCursor };
  }
  /** Server-side filename search; only matches and their ancestor metadata cross the boundary. */
  async function* search(query: string, conditions: ExplorerSearchConditions, signal: AbortSignal,
    wait: (signal: AbortSignal) => Promise<void> = waitForLazyFolder): AsyncGenerator<ExplorerSearchBatch> {
    signal.throwIfAborted();
    const index = entries, matches = findMatches(query, conditions), sent = new Set<string>();
    for (let offset = 0; offset < matches.length; offset += 2) {
      await wait(signal);
      signal.throwIfAborted();
      yield makeSearchBatch(index, matches.slice(offset, offset + 2), sent);
    }
  }
  function save(payload: ExplorerSavePayload): ExplorerEntry[] {
    if (payload.scope?.kind !== "partial") throw new Error("このデモでは部分キャッシュの差分を保存します。");
    const nextEntries = new Map(entries), nextBodies = new Map(bodies);
    for (const entry of payload.changes.deleted) nextEntries.delete(entry.id);
    for (const entry of payload.changes.created) if (nextEntries.has(entry.id)) throw new Error("追加するIDが重複しています。");
    for (const entry of payload.changes.updated) if (!nextEntries.has(entry.id)) throw new Error("更新対象がありません。");
    for (const entry of [...payload.changes.created, ...payload.changes.updated]) {
      const saved = clone(entry);
      if (saved.kind === "file") {
        if (saved.source?.kind === "local") {
          // Immutable body keys keep a copied file's earlier content intact.
          const id = `saved:${crypto.randomUUID()}`;
          nextBodies.set(id, saved.source.file);
          saved.source = { kind: "existing", id };
        } else if (!saved.source || !nextBodies.has(saved.source.id)) throw new Error("ファイル本体が見つかりません。");
      }
      nextEntries.set(saved.id, saved);
    }
    // Validate the full server tree before committing any changes.
    const validated = createSnapshot([...nextEntries.values()]);
    const validatedEntries = new Map(validated.entries.map(entry => [entry.id, entry]));
    const cached = payload.entries.map(entry => {
      const saved = validatedEntries.get(entry.id);
      if (!saved) throw new Error("返却するキャッシュ項目が見つかりません。");
      return clone(saved);
    });
    const usedBodies = new Set(validated.entries.flatMap(entry => entry.source?.kind === "existing" ? [entry.source.id] : []));
    entries = validatedEntries;
    bodies = new Map([...nextBodies].filter(([id]) => usedBodies.has(id)));
    return cached;
  }
  return {
    initialEntries: [clone(entries.get(lazyDemoSalesId)!)],
    list, search, searchPage, save,
    snapshot: () => [...entries.values()].map(clone),
    count: () => entries.size,
    async readFile(id: string) { const blob = bodies.get(id); if (!blob) throw new Error("ファイルがありません。"); return blob; },
  };
}

/** A cancellable stand-in for network latency, without any external connection. */
export function waitForLazyFolder(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 350);
    function cancel() { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(signal.reason); }
    signal.addEventListener("abort", cancel, { once: true });
  });
}
