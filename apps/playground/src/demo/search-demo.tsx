import type { ReactNode } from "react";
import "./search-demo.css";

export type SearchDemoTrigger = "input" | "submit";
export type SearchDemoTrace = { sequence: number; query: string; pattern: string; matchCase: boolean; wholeText: boolean; useRegex: boolean; count: number; scope: string };

/** Preview the literal pattern; matching itself uses the public library APIs. */
export function searchDemoPattern(text: string, matchCase = false, wholeText = false, useRegex = false): string {
  if (!text) return "（未入力）";
  const source = useRegex ? text.replace(/\//g, "\\/") : text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return `/${wholeText ? useRegex ? `^(?:${source})$` : `^${source}$` : source}/${matchCase ? "" : "i"}`;
}

export function SearchDemoControl({ input, text, matchCase, wholeText, useRegex, disabled, searching, error, onMatchCase, onWholeText, onUseRegex, submit, clear, children }: {
  input: ReactNode; text: string; matchCase: boolean; wholeText: boolean; useRegex: boolean; disabled?: boolean; searching?: boolean; error?: string | null;
  onMatchCase(value: boolean): void; onWholeText(value: boolean): void; onUseRegex(value: boolean): void; submit(): void; clear(): void; children?: ReactNode;
}) {
  return <div className="search-demo-control">
    <div className="search-demo-input">{input}<button type="button" disabled={disabled || !text} onClick={submit}>検索</button><button type="button" disabled={disabled || !text} onClick={clear} aria-label="検索条件をクリア">クリア</button></div>
    <div className="search-demo-conditions">
      <label>入力方式<select aria-label="検索の入力方式" value={useRegex ? "regex" : "literal"} disabled={disabled} onChange={event => onUseRegex(event.target.value === "regex")}><option value="literal">文字列</option><option value="regex">正規表現</option></select></label>
      <label><input type="checkbox" checked={matchCase} disabled={disabled} onChange={event => onMatchCase(event.target.checked)} />大小文字を区別</label>
      <label>一致方法<select value={wholeText ? "whole" : "partial"} disabled={disabled} onChange={event => onWholeText(event.target.value === "whole")}><option value="partial">部分一致</option><option value="whole">全体一致</option></select></label>
    </div>
    <div className="search-demo-pattern"><span>生成した正規表現</span><code aria-label="生成した正規表現">{searchDemoPattern(text, matchCase, wholeText, useRegex)}</code></div>
    {useRegex && <p className="search-demo-regex-note">RE2形式。先読み・後読み・後方参照は使えません。</p>}
    {searching && <span role="status">検索中…</span>}
    {error && <p role="alert" className="search-demo-error">{error}</p>}
    {children}
  </div>;
}

export function SearchDemoFrame({ kind, trigger, onTrigger, trace, introduction, examples, children }: {
  kind: "explorer" | "spreadsheet"; trigger: SearchDemoTrigger; onTrigger(value: SearchDemoTrigger): void; trace: SearchDemoTrace | null; introduction?: ReactNode; examples?: ReactNode; children: ReactNode;
}) {
  return <div className={`search-demo search-demo-${kind}`}>
    <header className="search-demo-header"><div><span className="search-demo-eyebrow">LikeX Playground</span><h1>検索 UI のカスタマイズ</h1></div>
      <nav aria-label="検索デモ"><a href="/explorer/search" aria-current={kind === "explorer" ? "page" : undefined}>Explorer</a><a href="/spreadsheet/search" aria-current={kind === "spreadsheet" ? "page" : undefined}>Spreadsheet</a><a href={`/${kind}`}>標準デモ</a></nav>
    </header>
    <div className="search-demo-workspace"><aside className="search-demo-guide" aria-label="検索デモの設定">
      <p className="search-demo-eyebrow">利用側で定義した検索</p><h2>文字列を、検索条件に。</h2>
      {introduction ?? <p>{kind === "explorer" ? "右上の検索欄を試してください。名前と一致したファイルが表示されます。" : "ホームの「検索」、または Ctrl / ⌘ + F で検索パネルを開いてください。結果を選ぶとセルに移動します。"}</p>}
      <fieldset><legend>検索するタイミング</legend><label><input type="radio" name="search-demo-trigger" value="input" checked={trigger === "input"} onChange={() => onTrigger("input")} />入力のたびに検索</label><label><input type="radio" name="search-demo-trigger" value="submit" checked={trigger === "submit"} onChange={() => onTrigger("submit")} />Enter または検索ボタン</label></fieldset>
      {examples ?? <div className="search-demo-examples"><h3>試す文字列</h3><dl><dt><code>Report</code></dt><dd>大小文字の区別で対象が変わります。</dd><dt><code>{kind === "explorer" ? "Report.txt" : "Report"}</code></dt><dd>全体一致で名前・値が同じものだけに。</dd><dt><code>C++</code> / <code>v1.2</code></dt><dd>文字列モードでは記号も普通の文字です。</dd><dt><code>^Report</code> / <code>(</code></dt><dd>正規表現モードでパターンと構文エラーを確認。</dd></dl></div>}
      <div className="search-demo-trace" role="status"><h3>最後に実行した検索</h3>{trace ? <><p className="search-demo-count">{trace.count}<small> 件一致</small></p><dl><dt>リクエスト</dt><dd>#{trace.sequence}</dd><dt>検索文字列</dt><dd>{trace.query}</dd><dt>実行パターン</dt><dd><code>{trace.pattern}</code></dd><dt>対象</dt><dd>{trace.scope}</dd></dl></> : <p>まだ検索していません。</p>}</div>
      <p className="search-demo-note">検索フォームと検索処理は、このデモの利用側コードから渡しています。サンプルデータはこの画面内で処理します。</p>
    </aside><main className="search-demo-app" aria-label={`${kind === "explorer" ? "Explorer" : "Spreadsheet"} 検索カスタマイズデモ`}>{children}</main></div>
  </div>;
}
