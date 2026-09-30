import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUpRight, File, LayoutGrid, List, Loader2, Plus, Presentation, RefreshCw, Search, Sheet, X } from "lucide-react";
import { demoDocumentStore, type DemoDocumentKind, type DemoDocumentRecord, type DemoDocumentSummary } from "./demo-document-store";
import "./demo-document-library.css";

export type DemoDocumentLibraryProps = {
  kind: DemoDocumentKind;
  label: string;
  createDocument(title: string, source: "blank" | "sample"): Promise<{ document: string; itemCount: number }>;
  onOpen(record: DemoDocumentRecord): void;
  colorMode: "light" | "dark" | "system";
  primaryColor?: string;
};
type Intent = { type: "create"; title: string; source: "blank" | "sample" } | { type: "open"; id: string };
type Listing = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; records: DemoDocumentSummary[] };
type Failure = { message: string; retry: Intent };
const message = (error: unknown) => error instanceof Error ? error.message : "処理を完了できませんでした。もう一度お試しください。";
const dateFormat = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** A kind change starts a separate library view and invalidates any late result. */
export function DemoDocumentLibrary(props: DemoDocumentLibraryProps) {
  return <Library key={props.kind} {...props} />;
}
function Library(props: DemoDocumentLibraryProps) {
  const { kind, label, colorMode, primaryColor } = props;
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [title, setTitle] = useState(`新しい${label}`);
  const [draft, setDraft] = useState<"blank" | "sample" | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "cards">(kind === "spreadsheet" ? "list" : "cards");
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [pending, setPending] = useState<Intent | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const live = useRef(false), busy = useRef(false), listVersion = useRef(0), actionVersion = useRef(0);
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const prefix = useId(), titleId = `${prefix}-title`, titleErrorId = `${prefix}-title-error`;
  const Icon = kind === "slide" ? Presentation : Sheet;
  const countUnit = kind === "slide" ? "枚のスライド" : "シート";
  const readList = useCallback(async () => {
    const version = ++listVersion.current;
    try {
      const records = await demoDocumentStore.list(kind);
      if (live.current && version === listVersion.current) setListing({ status: "ready", records });
    } catch (error) {
      if (live.current && version === listVersion.current) setListing({ status: "error", message: message(error) });
    }
  }, [kind]);
  const invalidate = useCallback(() => { live.current = false; listVersion.current++; actionVersion.current++; }, []);
  useEffect(() => {
    live.current = true;
    let mounted = true;
    queueMicrotask(() => { if (mounted) void readList(); });
    return () => { mounted = false; invalidate(); };
  }, [readList, invalidate]);
  function refresh() {
    if (busy.current) return;
    setListing({ status: "loading" }); setFailure(null); void readList();
  }
  async function run(intent: Intent) {
    if (!live.current || busy.current) return;
    busy.current = true; const version = ++actionVersion.current;
    const current = () => live.current && version === actionVersion.current;
    setPending(intent); setFailure(null);
    let retry = intent;
    try {
      let record: DemoDocumentRecord | undefined;
      if (intent.type === "create") {
        const generated = await latest.current.createDocument(intent.title, intent.source);
        if (!current()) return;
        record = await demoDocumentStore.create({ kind, title: intent.title, ...generated });
        if (!current()) return;
        // A host can reject an unreadable document. Retry that saved record instead
        // of creating a second copy, and keep the successful save in the listing.
        retry = { type: "open", id: record.id };
        listVersion.current++;
        const { document: _document, ...summary } = record; void _document;
        setListing(previous => ({ status: "ready", records: [summary, ...(previous.status === "ready" ? previous.records.filter(item => item.id !== summary.id) : [])] }));
      } else record = await demoDocumentStore.get(intent.id);
      if (!current()) return;
      if (!record) throw new Error("資料が見つかりません。一覧を更新して再試行してください。");
      if (record.kind !== kind) throw new Error("資料の種類が一致しません。一覧を更新して再試行してください。");
      latest.current.onOpen(record);
    } catch (error) { if (current()) setFailure({ message: message(error), retry }); }
    finally { if (current()) { busy.current = false; setPending(null); } }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || draft === null) return;
    const name = title.trim();
    if (!name) { setTitleError("資料名を入力してください。"); return; }
    if (name.length > 1000) { setTitleError("資料名は1,000文字以内で入力してください。"); return; }
    setTitleError(null); void run({ type: "create", title: name, source: draft });
  }
  function begin(source: "blank" | "sample", button: HTMLButtonElement) {
    if (busy.current) return;
    trigger.current = button; setTitle(source === "sample" ? `${label}のサンプル` : `新しい${label}`);
    setTitleError(null); setFailure(null); setDraft(source);
  }
  function close() {
    if (busy.current) return;
    setDraft(null); setTitleError(null); setFailure(null);
    requestAnimationFrame(() => { if (live.current) trigger.current?.focus(); });
  }
  function modalKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)")];
    const first = controls[0], last = controls.at(-1), active = event.currentTarget.ownerDocument.activeElement;
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  }
  const keyword = search.trim().normalize("NFKC").toLocaleLowerCase("ja-JP");
  const records = listing.status === "ready" ? [...listing.records].filter(record => record.title.normalize("NFKC").toLocaleLowerCase("ja-JP").includes(keyword))
    .sort((a, b) => sort === "updated" ? b.updatedAt - a.updatedAt || a.title.localeCompare(b.title, "ja-JP") : a.title.localeCompare(b.title, "ja-JP") || b.updatedAt - a.updatedAt) : [];
  const errorBox = failure && <div className="demo-document-error" role="alert"><p>{failure.message}</p><button type="button" disabled={!!pending} onClick={() => void run(failure.retry)}>もう一度試す</button></div>;
  return <main className="demo-document-library" data-document-kind={kind} data-color-mode={colorMode}
    style={{ "--document-primary": primaryColor ?? (kind === "slide" ? "#b95634" : "#217346") } as CSSProperties}>
    <div inert={draft !== null ? true : undefined}>
      <header className="demo-document-library-heading">
        <div className="demo-document-app-name"><Icon size={29} strokeWidth={1.8} aria-hidden="true" /><h1>{label}</h1><span>AI</span></div>
        <label className="demo-document-search"><Search size={19} aria-hidden="true" /><input type="search" aria-label="保存した資料を検索" placeholder="保存した資料を検索" value={search} onChange={event => setSearch(event.target.value)} /></label>
      </header>
      <section className="demo-document-create" aria-labelledby={`${prefix}-create-heading`}>
        <div className="demo-document-library-inner">
          <div className="demo-document-section-title"><h2 id={`${prefix}-create-heading`}>新しい{label}を作成</h2><p className="demo-document-save-hint">このブラウザーに保存されます。</p></div>
          <div className="demo-document-templates">
            <button type="button" className="demo-document-template" aria-label={`空白の${label}を作成`} disabled={!!pending} onClick={event => begin("blank", event.currentTarget)}>
              <span className="demo-document-template-preview is-blank" aria-hidden="true"><Plus size={43} strokeWidth={1.8} /></span><strong>空白の{label}</strong>
            </button>
            <button type="button" className="demo-document-template" aria-label={`サンプルの${label}を作成`} disabled={!!pending} onClick={event => begin("sample", event.currentTarget)}>
              <span className={`demo-document-template-preview is-sample is-${kind}`} aria-hidden="true"><span className="demo-document-preview-heading" /><span className="demo-document-preview-body" /><span className="demo-document-preview-accent" /></span><strong>サンプル</strong><small>データと書式を試す</small>
            </button>
          </div>
        </div>
      </section>
      <section className="demo-document-saved demo-document-library-inner" aria-labelledby={`${prefix}-saved-heading`} aria-busy={listing.status === "loading" || pending?.type === "open"}>
        <div className="demo-document-section-title"><h2 id={`${prefix}-saved-heading`}>{keyword ? "検索結果" : "最近使った資料"}{listing.status === "ready" && <span className="demo-document-count" aria-live="polite">{records.length}件</span>}</h2>
          <div className="demo-document-list-controls"><select aria-label="資料の並び順" value={sort} disabled={!!pending} onChange={event => setSort(event.target.value as "updated" | "title")}><option value="updated">最終更新</option><option value="title">名前</option></select>
            <button type="button" aria-label={view === "list" ? "カード表示に切り替え" : "一覧表示に切り替え"} title={view === "list" ? "カード表示" : "一覧表示"} disabled={!!pending} onClick={() => setView(view === "list" ? "cards" : "list")}>{view === "list" ? <LayoutGrid size={19} /> : <List size={20} />}</button>
            <button type="button" aria-label="一覧を更新" title="一覧を更新" disabled={!!pending || listing.status === "loading"} onClick={refresh}><RefreshCw size={17} /></button>
          </div>
        </div>
        {draft === null && errorBox}
        {listing.status === "loading" ? <p className="demo-document-list-status" role="status"><Loader2 className="demo-document-spinner" size={18} aria-hidden="true" />保存した資料を読み込んでいます…</p>
          : listing.status === "error" ? <div className="demo-document-error" role="alert"><p>{listing.message}</p><button type="button" disabled={!!pending} onClick={refresh}>一覧を再読み込み</button></div>
          : records.length === 0 ? <div className="demo-document-empty"><File size={29} strokeWidth={1.3} aria-hidden="true" /><p>{keyword ? "一致する資料がありません。" : "保存した資料はまだありません。"}</p><span>{keyword ? "別のキーワードで検索してください。" : "新しく作成した資料が、ここに並びます。"}</span></div>
          : <><div className={`demo-document-list-columns${view === "cards" ? " is-hidden" : ""}`} aria-hidden="true"><span>名前</span><span>内容</span><span>最終更新</span></div>
            <ul className={`demo-document-records is-${view}`}>{records.map(record => <li key={record.id}>
              <button type="button" className="demo-document-card" disabled={!!pending} aria-label={`${record.title}を開く`} aria-describedby={`${prefix}-${record.id}-count ${prefix}-${record.id}-date`} onClick={() => void run({ type: "open", id: record.id })}>
                <span className="demo-document-file-icon" aria-hidden="true"><Icon size={25} strokeWidth={1.5} /></span>
                <strong title={record.title}>{record.title}</strong><span id={`${prefix}-${record.id}-count`} className="demo-document-item-count">{record.itemCount} {countUnit}</span>
                <time id={`${prefix}-${record.id}-date`} className="demo-document-date" dateTime={new Date(record.updatedAt).toISOString()}>{dateFormat.format(record.updatedAt)}</time>
                <span className="demo-document-open-icon" aria-hidden="true">{pending?.type === "open" && pending.id === record.id ? <Loader2 className="demo-document-spinner" size={17} /> : <ArrowUpRight size={17} />}</span>
              </button>
            </li>)}</ul></>}
        {pending?.type === "open" && <p className="demo-document-opening" role="status">資料を開いています…</p>}
      </section>
    </div>
    {draft !== null && <div className="demo-document-modal-backdrop"><div className="demo-document-modal" role="dialog" aria-modal="true" aria-labelledby={`${prefix}-dialog-heading`} onKeyDown={modalKey}>
      <div className="demo-document-modal-heading"><h2 id={`${prefix}-dialog-heading`}>{draft === "sample" ? "サンプルから作成" : "空白から作成"}</h2><button type="button" aria-label="作成をキャンセル" disabled={!!pending} onClick={close}><X size={18} /></button></div>
      <form onSubmit={create} aria-label={`新しい${label}を作成`} aria-busy={pending?.type === "create"}>
        <div className="demo-document-title-field"><label htmlFor={titleId}>資料名</label><input autoFocus id={titleId} value={title} maxLength={1000} required autoComplete="off" disabled={!!pending} aria-invalid={!!titleError} aria-describedby={titleError ? titleErrorId : undefined}
          onChange={event => { setTitle(event.target.value); setTitleError(null); }} /></div>
        {titleError && <p className="demo-document-field-error" id={titleErrorId} role="alert">{titleError}</p>}
        {errorBox}
        <div className="demo-document-modal-actions"><button type="button" className="demo-document-cancel" disabled={!!pending} onClick={close}>キャンセル</button><button type="submit" className="demo-document-create-button" disabled={!!pending}>
          {pending?.type === "create" && <Loader2 className="demo-document-spinner" size={17} aria-hidden="true" />}<span>{pending?.type === "create" ? "作成しています…" : "作成して開く"}</span>
        </button></div>
      </form>
    </div></div>}
  </main>;
}
export default DemoDocumentLibrary;
