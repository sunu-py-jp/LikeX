import { useCallback, useState } from "react";
import { ExplorerPicker, ExplorerPickerDialog, type ExplorerFolderLoadHandler, type ExplorerPickerItem, type ExplorerSearchHandler } from "@likex/explorer";
import { createLazyFolderServer, waitForLazyFolder } from "./demo/lazy-folder-server";
import "../../../packages/explorer/src/styles.css";
import "./demo/picker-demo.css";

const modes = [
  { id: "file", label: "ファイルを1つ", kind: "file", multiple: false },
  { id: "files", label: "複数のファイル", kind: "file", multiple: true },
  { id: "folder", label: "フォルダを1つ", kind: "folder", multiple: false },
  { id: "both", label: "ファイルとフォルダ", kind: "both", multiple: true },
] as const;
type Mode = typeof modes[number];
type ConfirmedResult = { source: string; mode: string; items: readonly ExplorerPickerItem[] };

export default function ExplorerPickerDemo() {
  const [server] = useState(createLazyFolderServer);
  const [initialEntries] = useState(() => server.list("root"));
  const [mode, setMode] = useState<Mode>(modes[0]), [open, setOpen] = useState(false);
  const [candidate, setCandidate] = useState<readonly ExplorerPickerItem[]>([]);
  const [result, setResult] = useState<ConfirmedResult | null>(null), [status, setStatus] = useState("まだ確定していません。");
  const [requests, setRequests] = useState<string[]>([]);
  const onLoadFolder = useCallback<ExplorerFolderLoadHandler>(async ({ folderId, path }, { signal }) => {
    setRequests(previous => [path, ...previous].slice(0, 12));
    await waitForLazyFolder(signal);
    signal.throwIfAborted();
    return server.list(folderId);
  }, [server]);
  const onSearchRequest = useCallback<ExplorerSearchHandler>((request, { signal }) =>
    server.search(request.query, request.conditions, signal), [server]);
  const confirm = (source: string, items: readonly ExplorerPickerItem[]) => {
    setResult({ source, mode: mode.label, items });
    setStatus(`${source}で${items.length}件を確定しました。`);
  };
  const shared = {
    initialEntries, onLoadFolder, onSearchRequest,
    folderLoading: { initialLoadedFolderIds: ["root"] },
    search: { debounceMs: 180 },
    kind: mode.kind, multiple: mode.multiple,
    rootLabel: "共有資料", colorMode: "light" as const,
    view: { defaultMode: "details" as const },
    confirmLabel: "選択を確定", cancelLabel: "キャンセル",
  };

  return <div className="picker-demo">
    <header className="picker-demo-header"><div><span>LikeX Playground</span><h1>ファイル・フォルダを選ぶ</h1><p>アプリが管理する資料を、埋め込み画面やダイアログから選択します。</p></div><nav><a href="/">標準デモ</a><a href="/explorer/lazy-loading">遅延読み込み</a></nav></header>
    <div className="picker-demo-controls"><div className="picker-demo-modes" role="group" aria-label="選択する種類">
      {modes.map(item => <button key={item.id} type="button" className="picker-demo-mode" aria-pressed={mode.id === item.id} onClick={() => { setMode(item); setCandidate([]); setStatus(`${item.label}に切り替えました。`); }}>{item.label}</button>)}
    </div><button type="button" className="picker-demo-launch" onClick={() => setOpen(true)}>ダイアログで選ぶ</button></div>
    <div className="picker-demo-workspace"><main className="picker-demo-main"><div className="picker-demo-section-title"><h2>ページに埋め込む</h2><span>{mode.multiple ? "Ctrl / Cmd または Shift で複数選択" : "単一選択"}</span></div>
      <div className="picker-demo-embedded"><ExplorerPicker key={mode.id} {...shared} title="資料を選択" aria-label="埋め込みファイル選択" onSelectionChange={setCandidate} onConfirm={items => confirm("埋め込み画面", items)} onCancel={() => setStatus("埋め込み画面の選択をキャンセルしました。確定済みの結果は保持します。")} style={{ height: "100%" }} /></div>
    </main><aside className="picker-demo-aside" aria-label="選択結果">
      <section><h2>確定した結果</h2><p className="picker-demo-status" role="status">{status}</p>{result ? <><p className="picker-demo-caption">{result.source} / {result.mode}</p><ol className="picker-demo-results">{result.items.map(item => <li key={item.id}><strong>{item.name}</strong><span>{item.kind === "root" ? "ルート" : item.kind === "folder" ? "フォルダ" : "ファイル"}</span><code>{item.path}</code><small>ID: {item.id}</small></li>)}</ol></> : <p>項目を選んで「選択を確定」を押すと、IDとパスをここへ表示します。</p>}</section>
      <section><h2>埋め込み画面の選択候補</h2><p>{candidate.length ? candidate.map(item => item.name).join("、") : "選択なし"}</p><p className="picker-demo-caption">選択変更と確定は別の通知です。選択しただけでは結果を更新しません。</p></section>
      <section><h2>操作のヒント</h2><p>ファイルはダブルクリックか Enter で確定します。フォルダは開いて中へ移動します。</p>{mode.kind !== "file" && <p>「現在のフォルダを選択」で、開いているフォルダやルートも選べます。</p>}<p>検索は未取得の資料も含む名前検索です。「機能仕様」などを入力できます。</p></section>
      <section><h2>必要な場所だけ取得</h2><p>初めにルート直下4項目を渡し、フォルダを開くと直下一覧を取得します。</p>{requests.length > 0 && <ol className="picker-demo-requests">{requests.map((path, index) => <li key={`${index}:${path}`}><code>{path}</code></li>)}</ol>}<p className="picker-demo-caption">350msの待機を入れたローカルデモです。外部通信・保存・端末上のファイル選択は行いません。ダイアログを開き直すと新しい選択セッションになります。</p></section>
    </aside></div>
    <ExplorerPickerDialog {...shared} open={open} onOpenChange={setOpen} dialogTitle={mode.label} dialogDescription="共有資料から選択してください。フォルダを開くと必要な一覧だけを取得します。" onConfirm={items => confirm("ダイアログ", items)} onCancel={() => setStatus("ダイアログをキャンセルしました。確定済みの結果は保持します。")} />
  </div>;
}
