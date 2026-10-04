import { useCallback, useRef, useState } from "react";
import Explorer, { type ExplorerEmptyStateRenderer, type ExplorerEventHandler, type ExplorerHandle, type ExplorerProps, type ExplorerSavePayload, type ExplorerSearchHandler, type ExplorerSearchRenderer } from "@likex/explorer";
import { createLazyFolderServer, lazyDemoSalesId, lazySearchExample, waitForLazyFolder } from "./demo/lazy-folder-server";
import "../../../packages/explorer/src/styles.css";
import "./demo/lazy-folder-demo.css";

type RequestLog = { id: number; path: string; folderId: string; status: "loading" | "success" | "cancelled" | "error"; count?: number };
const statusLabels = { loading: "取得中", success: "完了", cancelled: "中断", error: "失敗" };
type SearchTrace = { id: number; query: string; hits: number; metadata: number; status: keyof typeof statusLabels };
const renderSearch: ExplorerSearchRenderer = context => <div className="lazy-folder-search">
  <span className="lazy-folder-search-scope">検索範囲：全件（未取得含む）</span>
  <div className="lazy-folder-search-input">{context.defaultInput}{context.defaultOptions}</div>
  <div className="lazy-folder-search-examples"><button type="button" onClick={() => { context.setConditions({ useRegex: true, wholeName: false, matchCase: false }); context.setQuery(lazySearchExample); }}>例：未取得の開発資料8件</button><button type="button" onClick={() => { context.setConditions({ useRegex: false, wholeName: false, matchCase: false }); context.setQuery("東雲製作所"); }}>例：未取得のフォルダ</button></div>
  <small>対象はファイル・フォルダ名です。結果の場所はパスで表示します。</small>
</div>;
const renderEmptyState: ExplorerEmptyStateRenderer = ({ reason, location, disabled, actions, defaultContent }) => {
  const customRoot = "/空のフォルダ";
  if (reason !== "folder" || location.kind !== "folder" ||
    location.path !== customRoot && !location.path.startsWith(`${customRoot}/`)) return defaultContent;
  return <div className="lazy-folder-empty"><section className="lazy-folder-empty-card" aria-label="資料整理の案内">
    <span className="lazy-folder-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10H3V7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M12 10v6m-3-3h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></span>
    <code className="lazy-folder-empty-path">{location.path}</code>
    <h2>ここから資料をまとめましょう</h2>
    <p>この場所に、関連する資料や作業用フォルダをまとめられます。</p>
    <div className="lazy-folder-empty-actions">
      {actions.addFiles && <button type="button" className="lazy-folder-empty-primary" disabled={disabled} onClick={actions.addFiles}>資料を追加</button>}
      {actions.createFolder && <button type="button" disabled={disabled} onClick={actions.createFolder}>分類用フォルダを作成</button>}
    </div>
  </section></div>;
};

export default function ExplorerLazyLoadingDemo() {
  const [server] = useState(createLazyFolderServer), explorer = useRef<ExplorerHandle>(null), requestId = useRef(0);
  const [requests, setRequests] = useState<RequestLog[]>([]), [events, setEvents] = useState<string[]>([]);
  const [cachedCount, setCachedCount] = useState(server.initialEntries.length), [dirty, setDirty] = useState(false), [location, setLocation] = useState("/");
  const [saveSummary, setSaveSummary] = useState("まだ保存していません。"), [serverCount, setServerCount] = useState(server.count());
  const [searchTrace, setSearchTrace] = useState<SearchTrace | null>(null), searchId = useRef(0);
  const onSearchRequest = useCallback<ExplorerSearchHandler>(async function* (request, { signal }) {
    signal.throwIfAborted();
    const id = ++searchId.current;
    setSearchTrace({ id, query: request.query, hits: 0, metadata: 0, status: "loading" });
    try {
      for await (const batch of server.search(request.query, request.conditions, signal)) {
        signal.throwIfAborted();
        setSearchTrace(previous => previous?.id === id ? { ...previous, hits: previous.hits + batch.hits.length, metadata: previous.metadata + batch.entries.length } : previous);
        yield batch;
      }
      setSearchTrace(previous => previous?.id === id ? { ...previous, status: "success" } : previous);
    } catch (error) {
      setSearchTrace(previous => previous?.id === id ? { ...previous, status: signal.aborted ? "cancelled" : "error" } : previous);
      throw error;
    }
  }, [server]);
  const onLoadFolder = useCallback<NonNullable<ExplorerProps["onLoadFolder"]>>(async ({ folderId, path }, { signal }) => {
    const id = ++requestId.current;
    setRequests(previous => [{ id, folderId, path, status: "loading" as const }, ...previous].slice(0, 40));
    try {
      await waitForLazyFolder(signal);
      signal.throwIfAborted();
      const entries = server.list(folderId);
      setRequests(previous => previous.map(item => item.id === id ? { ...item, status: "success", count: entries.length } : item));
      return entries;
    } catch (error) {
      setRequests(previous => previous.map(item => item.id === id ? { ...item, status: signal.aborted ? "cancelled" : "error" } : item));
      throw error;
    }
  }, [server]);
  const onEvent = useCallback<ExplorerEventHandler>(event => {
    if (event.type === "folder-load" && event.status === "success") setCachedCount(count => count + event.addedCount);
    if (event.type === "search-hydrate") setCachedCount(count => count + event.addedCount);
    if (event.type === "change" || event.type === "discard" || event.type === "save" && event.status === "success") setCachedCount(event.entries.length);
    if (event.type === "navigate") {
      const value = event.location.path ?? event.location.name;
      setLocation(value); setEvents(previous => [`navigate → ${value}`, ...previous].slice(0, 12));
    }
  }, []);
  const onSave = useCallback((payload: ExplorerSavePayload) => {
    const cached = server.save(payload), { created, updated, deleted } = payload.changes;
    setServerCount(server.count());
    setSaveSummary(`差分保存：追加 ${created.length}・更新 ${updated.length}・削除 ${deleted.length}。返却はキャッシュ ${cached.length} 件のみ。サーバーは ${server.count()} 件を保持。`);
    return cached;
  }, [server]);

  return <div className="lazy-folder-demo">
    <header><div><span>LikeX Playground</span><h1>必要なフォルダから読み込む</h1></div><nav><a href="/">標準デモ</a><a href="/explorer/search">検索デモ</a></nav></header>
    <div className="lazy-folder-workspace"><aside aria-label="遅延読み込みの状態">
      <h2>初期キャッシュは1項目</h2><p>営業資料 → 2026年度 → 東雲製作所を開くと、最後に320件のファイルが届きます。開き直したフォルダはキャッシュを使います。</p>
      <div className="lazy-folder-stats"><div><strong>{cachedCount}</strong><span>取得済み項目</span></div><div><strong>{serverCount}</strong><span>サーバー全項目</span></div></div>
      <section className="lazy-folder-search-summary" aria-label="全件検索の状態"><h3>全件検索（未取得含む）</h3><p>検索はサーバー側の全{serverCount.toLocaleString()}項目を対象にし、ヒットと祖先だけを返します。</p>{searchTrace ? <p role="status"><strong>{searchTrace.hits} 件ヒット</strong>・{statusLabels[searchTrace.status]}<br />受信メタデータ {searchTrace.metadata} 件<br /><code>{searchTrace.query}</code></p> : <p>「未取得の開発資料8件」を試すと、初回キャッシュ4件から18件だけに増えます。</p>}<p className="lazy-folder-note">検索で届いたフォルダは直下の取得完了にはなりません。開くと残りの一覧を取得します。</p></section>
      <p className="lazy-folder-location">現在地：<code>{location}</code><br />{dirty ? "未保存の変更があります" : "未保存の変更なし"}</p>
      <div className="lazy-folder-actions"><button type="button" onClick={() => explorer.current?.navigate("/営業資料")}>営業資料を開く</button><button type="button" onClick={() => explorer.current?.navigate("/")}>ルートへ戻る</button><button type="button" onClick={() => { void explorer.current?.loadFolder(lazyDemoSalesId, { recursive: true }); }}>営業資料の配下を読み込む</button></div>
      <p>フォルダを含む変更やZIPは、必要な配下を読み込んでから実行します。ファイル名変更 → 保存で、未取得の資料が残る差分保存を確認できます。</p>
      <p className="lazy-folder-note">「空のフォルダ」とその配下だけ、利用側の案内と追加ボタンに差し替えています。</p>
      <section aria-label="保存の結果"><h3>保存の結果</h3><p>{saveSummary}</p></section>
      <section aria-label="移動イベント"><h3>移動イベント</h3><p className="lazy-folder-note">初回表示ではnavigateを通知しません。</p>{events.length ? <ol>{events.map((event, index) => <li key={`${index}:${event}`}>{event}</li>)}</ol> : <p>フォルダへ移動すると表示します。</p>}</section>
      <p className="lazy-folder-note">350msの待機を入れたローカルデモです。外部通信・永続保存はなく、再読込で初期状態に戻ります。</p>
    </aside><main><div className="lazy-folder-explorer"><Explorer ref={explorer} title="フォルダ単位の取得" initialEntries={server.initialEntries} onLoadFolder={onLoadFolder} folderLoading={{ initialLoadedFolderIds: [] }} onSearchRequest={onSearchRequest} renderSearch={renderSearch} renderEmptyState={renderEmptyState} search={{ debounceMs: 180, resultDetailsHeight: 48 }} onSave={onSave} onEvent={onEvent} onDirtyChange={setDirty} readFile={server.readFile} colorMode="light" view={{ defaultMode: "details" }} style={{ height: "100%", border: 0, borderRadius: 0 }} /></div>
      <section className="lazy-folder-requests" aria-label="フォルダ取得履歴"><h2>フォルダ取得履歴 <small>{requests[0]?.id ?? 0} リクエスト</small></h2><p>既に読み込んだ場所へ戻っても、この履歴は増えません。</p><div><table><thead><tr><th>#</th><th>要求したパス</th><th>状態</th><th>直下の件数</th></tr></thead><tbody>{requests.map(item => <tr key={item.id}><td>{item.id}</td><td><code>{item.path}</code></td><td>{statusLabels[item.status]}</td><td>{item.count ?? "—"}</td></tr>)}</tbody></table></div></section>
    </main></div>
  </div>;
}
