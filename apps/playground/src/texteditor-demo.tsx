import { useCallback, useMemo, useRef, useState } from "react";
import { FileText, NotebookPen, Code2, ArrowUpRight, Moon, Sun, Check, Command } from "lucide-react";
import { LikeTextEditor, createTextEditorModel, type TextEditorModel, type TextEditorHandle, type TextEditorProps, type TextEditorSearchResult, type TextEditorMode } from "@likex/texteditor";
import "../../../packages/texteditor/src/styles.css";
import "./texteditor-demo.css";
const markdown = createTextEditorModel({ id: "writing-notes", title: "新しいアイデア.md", mode: "markdown", text: "# 考えを、自由に書き留める。\n\n思いついたアイデアも、チームに届ける文章も。\nここは、言葉に集中するための小さなワークスペースです。\n\n## 今週、試してみたいこと\n\n- 書き始める前に、伝えたいことを一つ決める\n- **大事な言葉**には、そっと強弱をつける\n- 小さな気づきを、次のアクションにつなげる\n\n> 完璧な文章よりも、まずは最初の一行から。\n\n## 自分らしい書き方で\n\n段落の先頭で `/` を入力すると、見出しやリストを追加できます。Markdownの記法で書いても、そのまま見た目に反映されます。\n\n---\n\n1. アイデアを集める\n2. アウトラインを整える\n3. チームに共有する\n" });
const text = createTextEditorModel({ id: "project-notes", title: "プロジェクトメモ.txt", mode: "text", text: "PROJECT NOTES\n──────────────────────────────────────────────\n\nプロジェクト名: 新しいワークスペース\n担当: デザインチーム\n更新日: 2026-10-30\n\n01  進めたいこと\n\n  TODO  アイデアを整理する\n  TODO  最初の画面をデザインする\n  TODO  チームからフィードバックを集める\n  TODO  次のステップを決める\n\n02  ショートカットを試す\n\n  Alt + クリック        複数の場所にカーソルを追加\n  Ctrl / ⌘ + D          次の同じ文字を選択\n  Alt + ↑ / ↓           行を移動\n  Alt + Shift + ↑ / ↓   行を複製\n  Ctrl / ⌘ + F          検索\n  Ctrl / ⌘ + H          置換\n  Ctrl / ⌘ + A          すべて選択\n\n03  メモ\n\n  考えたことを、すばやく形に。\n  行番号や複数カーソルで、繰り返しの編集も軽やかに。\n" });
const json = createTextEditorModel({ id: "json-settings", title: "settings.json", mode: "json", text: `{"name":"チームのワークスペース","enabled":true,"retryCount":3,"owner":null,"appearance":{"theme":"light","fontSize":14},"members":[{"name":"田中","role":"editor"},{"name":"佐藤","role":"viewer"}]}` });
const xml = createTextEditorModel({ id: "xml-settings", title: "settings.xml", mode: "xml", text: `<?xml version="1.0" encoding="UTF-8"?>
<!-- ワークスペースの表示設定 -->
<workspace name="チームのワークスペース" enabled="true"><appearance theme="light" fontSize="14" /><members><member role="editor">田中</member><member role="viewer">佐藤</member></members><message><![CDATA[共有したい情報を、見やすく。]]></message></workspace>
` });
const yaml = createTextEditorModel({ id: "yaml-settings", title: "settings.yaml", mode: "yaml", text: `# ワークスペースの表示設定
name: チームのワークスペース
enabled: true
retryCount: 3
owner: null
appearance: &appearance
    theme: light
    fontSize: 14
sharedAppearance: *appearance
members:
    - name: 田中
      role: editor
    - name: 佐藤
      role: viewer
message: |
    共有したい情報を、見やすく。
    色分けで設定の構造を確認できます。
` });
const auto = createTextEditorModel({ id: "auto-settings", title: "settings.json", mode: "text", text: json.text });
type DemoKind = TextEditorMode | "auto";
const initialDocuments = { auto, markdown, text, json, xml, yaml };
const invalidSamples = {
  auto: '{"name": "設定", "enabled": }',
  json: '{"name": "設定", "enabled": }',
  xml: '<workspace>\n  <member>田中</workspace>',
  yaml: 'members: [田中, 佐藤\n',
};
const examples: Record<DemoKind, { label: string; hint: string; heading: string; description: string; query: string }> = {
  auto: { label: "自動判別", hint: "ファイル名・MIMEから選ぶ", heading: "ファイルに合った表示へ。", description: "モードを指定せずに、拡張子やメタデータから表示を選びます。", query: "name" },
  markdown: { label: "Markdown", hint: "見たまま、書き進める", heading: "アイデアに、心地よい余白を。", description: "見出しも、リストも、引用も。考える速さで書き進める。", query: "アイデア" },
  text: { label: "テキスト", hint: "速く、正確に編集する", heading: "テキスト編集を、思いのままに。", description: "複数カーソルとショートカットで、繰り返しの作業をすばやく。", query: "TODO" },
  json: { label: "JSON", hint: "キーと値を見分ける", heading: "データの構造を、見やすく。", description: "キー、文字列、数値、真偽値を色分けして表示します。", query: "name" },
  xml: { label: "XML", hint: "タグ・属性を読み解く", heading: "タグのつながりを、読みやすく。", description: "タグ、属性、文字列、コメントを見分けながら編集できます。", query: "member" },
  yaml: { label: "YAML", hint: "階層と設定を確かめる", heading: "設定ファイルを、すっきりと。", description: "キー、値、コメントを色分けし、階層を読み取りやすくします。", query: "name" },
};
export default function TextEditorDemo() {
  const [kind, setKind] = useState<DemoKind>("auto"), [dark, setDark] = useState(false), [readOnly, setReadOnly] = useState(false);
  const [documents, setDocuments] = useState(initialDocuments);
  const [autoMetadata, setAutoMetadata] = useState(false);
  const [formattingEnabled, setFormattingEnabled] = useState(false), [indent, setIndent] = useState(2);
  const supportsFormatting = kind === "auto" || kind === "json" || kind === "xml" || kind === "yaml";
  const savedDocuments = useRef(initialDocuments);
  const [saved, setSaved] = useState(false);
  const [coloredHeader, setColoredHeader] = useState(false);
  const [features, setFeatures] = useState({ search: true, replace: true, formatting: true, validation: true, save: true });
  const [status, setStatus] = useState({ editMode: "view", pendingInput: false, dirty: false });
  const [feedback, setFeedback] = useState("");
  const editor = useRef<TextEditorHandle>(null);
  const change = useCallback((model: TextEditorModel) => { setDocuments(current => ({ ...current, [kind]: model })); setSaved(false); }, [kind]);
  const save = useCallback((document: TextEditorModel) => {
    savedDocuments.current = { ...savedDocuments.current, [kind]: document };
    setDocuments(current => ({ ...current, [kind]: document })); setSaved(true);
  }, [kind]);
  const refresh = useCallback(() => savedDocuments.current[kind], [kind]);
  const captureState = useCallback((editMode?: string) => {
    const state = editor.current?.getState();
    if (state) setStatus({ editMode: editMode ?? state.editMode, pendingInput: state.pendingInput, dirty: state.hasUnsavedChanges });
  }, []);
  const onEvent = useCallback<NonNullable<TextEditorProps["onEvent"]>>(event => captureState(event.type === "edit-mode" ? event.mode : undefined), [captureState]);
  const onUnsavedChangesChange = useCallback(() => captureState(), [captureState]);
  const externalSearch = useMemo(() => {
    const results: TextEditorSearchResult[] = [];
    let offset = 0;
    for (const [index, line] of documents[kind].text.split("\n").entries()) {
      if (line.trim() && !/^[-─]+$/.test(line.trim())) results.push({
        id: `line-${index}`, title: line.replace(/^\s*(?:#{1,6}\s+|[-*>]\s+|\d+\.\s+)?/, "").slice(0, 28),
        snippet: line, locationLabel: `${index + 1} 行`, target: { from: offset, to: offset + line.length },
      });
      offset += line.length + 1;
    }
    return { title: "デモの外部検索結果", results };
  }, [documents, kind]);
  async function run(label: string, operation: () => boolean | Promise<boolean> | undefined) {
    const accepted = await operation();
    captureState();
    setFeedback(accepted ? `${label}しました` : `「${label}」は現在の状態では実行できません`);
  }
  function switchKind(next: DemoKind) { setKind(next); setSaved(false); setFeedback(""); setStatus({ editMode: "view", pendingInput: false, dirty: false }); }
  return <div className={`texteditor-demo ${dark ? "texteditor-demo-dark" : ""}`}>
    <header className="te-demo-top"><a href="/texteditor" className="te-demo-brand"><span><NotebookPen size={20} /></span>LikeTextEditor</a><div className="te-demo-top-right"><span className="te-demo-component">COMPONENT PREVIEW</span><a href="/explorer">Explorer <ArrowUpRight size={13} /></a><button type="button" aria-label="テーマを切り替え" onClick={() => setDark(value => !value)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div></header>
    <div className="te-demo-layout"><aside className="te-demo-sidebar"><div className="te-demo-space"><span className="te-demo-space-icon">W</span><div><strong>My workspace</strong><small>書くことを、もっと自由に。</small></div></div><p className="te-demo-nav-title">エディター</p>{(Object.keys(examples) as DemoKind[]).map(item => <button key={item} type="button" aria-pressed={kind === item} onClick={() => switchKind(item)}>{item === "markdown" ? <NotebookPen size={17} /> : <Code2 size={17} />}<span>{examples[item].label}<small>{examples[item].hint}</small></span></button>)}<div className="te-demo-side-bottom"><Command size={18} /><strong>使いたい操作を、すぐに。</strong><p>検索、置換、全選択、行の移動。<br />コマンド一覧から探せます。</p><button type="button" onClick={() => void editor.current?.runCommand("commandPalette")}>コマンドを開く <span>↗</span></button></div></aside>
    <main className="te-demo-main"><div className="te-demo-heading"><div><p className="te-demo-eyebrow">WRITE YOUR WAY</p><h1>{examples[kind].heading}</h1><p>{examples[kind].description}</p></div><div className="te-demo-options"><label className="te-demo-mode-select">表示例<select aria-label="表示例" value={kind} onChange={event => switchKind(event.target.value as DemoKind)}>{(Object.keys(examples) as DemoKind[]).map(item => <option key={item} value={item}>{examples[item].label}</option>)}</select></label>{kind === "auto" && <label className="te-demo-readonly"><input type="checkbox" checked={autoMetadata} onChange={event => setAutoMetadata(event.target.checked)} />MIMEから判別</label>}<label className="te-demo-readonly"><input type="checkbox" checked={coloredHeader} onChange={event => setColoredHeader(event.target.checked)} />カラーヘッダー</label><label className="te-demo-readonly"><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} />閲覧専用</label></div></div>
      <section className="te-demo-controls" aria-label="利用側のAPI操作">
        <div className="te-demo-controls-row"><span className="te-demo-controls-label">外からの操作</span>
          <button type="button" disabled={!features.search} onClick={() => editor.current?.openExternalSearch()}>外部検索結果</button>
          <button type="button" disabled={!features.search} onClick={() => editor.current?.openSearch(examples[kind].query)}>検索を開く</button>
          <button type="button" onClick={() => editor.current?.closePanels()}>パネルを閉じる</button>
          <span className="te-demo-edit-state" aria-live="polite">{status.editMode === "edit" ? "編集中" : status.editMode === "requesting" ? "許可待ち" : "閲覧中"}{status.pendingInput ? " · 入力待ち" : status.dirty ? " · 未保存" : ""}</span>
        </div>
        {supportsFormatting && <div className="te-demo-controls-row te-demo-formatting-controls" role="group" aria-label="整形表示と構文診断の例">
          <label><input type="checkbox" checked={formattingEnabled} onChange={event => setFormattingEnabled(event.target.checked)} />整形表示を有効にする</label>
          <label className="te-demo-mode-select">インデント<select aria-label="整形のインデント" value={indent} disabled={!formattingEnabled} onChange={event => setIndent(Number(event.target.value))}>{Array.from({ length: 8 }, (_, index) => index + 1).map(size => <option key={size} value={size}>{size} スペース</option>)}</select></label>
          <button type="button" disabled={readOnly} onClick={() => void run("エラー例を読み込み", async () => Boolean(await editor.current?.execute({ type: "text.set", text: invalidSamples[kind] })))}>エラー例を読み込む</button>
          <button type="button" disabled={readOnly} onClick={() => void run("初期サンプルに変更", async () => Boolean(await editor.current?.execute({ type: "text.set", text: initialDocuments[kind].text })))}>初期サンプルに戻す</button>
        </div>}
        <details><summary>機能設定と編集制御</summary>
          <div className="te-demo-controls-row" role="group" aria-label="有効にする機能">{([["search", "検索"], ["replace", "置換"], ["formatting", "書式"], ["validation", "構文診断"], ["save", "保存"]] as const).map(([feature, label]) => <label key={feature}><input type="checkbox" checked={features[feature]} onChange={event => setFeatures(current => ({ ...current, [feature]: event.target.checked }))} />{label}</label>)}</div>
          <div className="te-demo-controls-row"><button type="button" disabled={readOnly} onClick={() => void run("編集を開始", () => editor.current?.requestEdit())}>編集を開始</button><button type="button" disabled={readOnly} onClick={() => void run("編集を終了", () => editor.current?.endEdit())}>編集を終了</button><button type="button" disabled={readOnly} onClick={() => void run("変更を破棄", () => editor.current?.discard())}>変更を破棄</button><button type="button" onClick={() => void run("保存済みを再読込", () => editor.current?.refresh())}>保存済みを再読込</button></div>
          <p className="te-demo-controls-note">再読込は未保存の変更があると止まります。破棄する場合は「変更を破棄」を選んでください。</p>
          {feedback && <p className="te-demo-controls-note" role="status">{feedback}</p>}
        </details>
      </section>
      <div className="te-demo-editor"><LikeTextEditor key={kind} ref={editor} initialDocument={documents[kind]} mode={kind === "auto" ? undefined : kind} fileName={kind === "auto" ? autoMetadata ? "settings" : "settings.json" : undefined} mimeType={kind === "auto" && autoMetadata ? "application/json" : undefined} formatting={supportsFormatting && formattingEnabled ? { indent } : false} readOnly={readOnly} features={features} externalSearch={externalSearch} headerStyle={coloredHeader ? { backgroundColor: "#1f4d3a", color: "#ffffff" } : undefined} colorMode={dark ? "dark" : "light"} onChange={change} onSave={save} onRefresh={refresh} onEvent={onEvent} onUnsavedChangesChange={onUnsavedChangesChange} /></div><footer className="te-demo-footer"><span><FileText size={13} />{kind === "auto" ? autoMetadata ? "application/json から JSON を自動判別" : "settings.json の拡張子から JSON を自動判別" : kind === "markdown" ? "Markdown とソースを自由に切り替え" : "Alt + クリックで複数カーソルを追加"}</span><span>{saved ? <><Check size={13} />このデモ内に保存しました</> : "LikeX · Text Editor"}</span></footer></main></div>
  </div>;
}
