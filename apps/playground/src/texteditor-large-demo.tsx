import { useEffect, useMemo, useRef, useState } from "react";
import { LikeTextEditor, createTextEditorModel, type TextEditorMode, type TextEditorModel } from "@likex/texteditor";
import "../../../packages/texteditor/src/styles.css";

/** A long, mixed document: headings, prose, lists, tasks, quotes and code. */
function largeMarkdown(blocks: number): string {
  const parts: string[] = ["# 大きなMarkdown文書"];
  for (let index = 1; index < blocks; index++) {
    const kind = index % 12;
    if (kind === 0) parts.push(`## セクション ${index / 12}`);
    else if (kind === 4) parts.push(`- 箇条書き ${index} の一つ目\n- **強調**と[リンク](https://example.com/${index})を含む項目\n- 三つ目の項目`);
    else if (kind === 7) parts.push("```ts\nconst value = " + index + ";\nif (value < 3) console.log(value | 1);\n```");
    else if (kind === 9) parts.push(`- [ ] 未完了のタスク ${index}\n- [x] 完了したタスク ${index}`);
    else if (kind === 10) parts.push(`> 引用 ${index}: 考えを、自由に書き留める。`);
    else parts.push(`これは段落 ${index} です。文章表示では、画面の近くにあるブロックだけを描画します。Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. *Emphasis* and \`code\` here.`);
  }
  return parts.join("\n\n") + "\n";
}
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index, name: `項目 ${index}`, enabled: index % 2 === 0, tags: ["a", "b", "c"], note: "Lorem ipsum dolor sit amet" }));
/** About the same amount of text for every kind, so the sizes can be compared. */
const sources: Record<TextEditorMode, (blocks: number) => string> = {
  markdown: largeMarkdown,
  text: blocks => Array.from({ length: blocks * 2 }, (_, index) => `${index + 1}: これはテキストの行です。Lorem ipsum dolor sit amet, consectetur adipiscing elit.`).join("\n"),
  json: blocks => JSON.stringify({ items: rows(blocks) }, null, 2),
  xml: blocks => `<?xml version="1.0" encoding="UTF-8"?>\n<items>\n${rows(blocks).map(row => `  <item id="${row.id}" enabled="${row.enabled}"><name>${row.name}</name><note>${row.note}</note></item>`).join("\n")}\n</items>\n`,
  yaml: blocks => `items:\n${rows(blocks).map(row => `  - id: ${row.id}\n    name: 項目 ${row.id}\n    enabled: ${row.enabled}\n    tags: [a, b, c]\n    note: Lorem ipsum dolor sit amet`).join("\n")}\n`,
};
const kinds: [TextEditorMode, string][] = [["markdown", "Markdown"], ["text", "テキスト"], ["json", "JSON"], ["xml", "XML"], ["yaml", "YAML"]];
const sizes = [2000, 8000, 30000];

export default function TextEditorLargeDemo() {
  const [blocks, setBlocks] = useState(8000), [kind, setKind] = useState<TextEditorMode>("markdown"), [rendered, setRendered] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const kilobytes = useMemo(() => sizes.map(size => Math.round(sources[kind](size).length / 1000)), [kind]);
  const document = useMemo<TextEditorModel>(() => createTextEditorModel({ id: `large-${kind}-${blocks}`, title: `large-${blocks}.${kind === "markdown" ? "md" : kind === "text" ? "txt" : kind}`, mode: kind, text: sources[kind](blocks) }), [blocks, kind]);
  useEffect(() => {
    // Show how much of the page is real content. Reading the DOM is for this demo only.
    const timer = window.setInterval(() => {
      const page = host.current?.querySelector(".lxte-rich-document");
      if (!page) { setRendered(`ソース表示: 描画している行 ${(host.current?.querySelectorAll(".cm-line").length ?? 0).toLocaleString()} 行`); return; }
      const total = page.children.length, placeholders = page.querySelectorAll(".lxte-rich-placeholder").length;
      setRendered(`ページ内の要素 ${page.querySelectorAll("*").length.toLocaleString()} 個 · 未描画のブロック/項目 ${placeholders.toLocaleString()} 個 · トップレベル ${total.toLocaleString()} ブロック`);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);
  return <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
    <header style={{ display: "flex", gap: 16, alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #e3e3df", fontSize: 13, flexWrap: "wrap" }}>
      <strong>LikeTextEditor — 大きなファイル</strong>
      <label>種類 <select aria-label="種類" value={kind} onChange={event => setKind(event.target.value as TextEditorMode)}>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>大きさ <select aria-label="文書の大きさ" value={blocks} onChange={event => setBlocks(Number(event.target.value))}>{sizes.map((size, index) => <option key={size} value={size}>{size.toLocaleString()} 件（約 {kilobytes[index].toLocaleString()} KB）</option>)}</select></label>
      <span aria-live="polite" data-testid="rendered">{rendered}</span>
      <a href="/texteditor" style={{ marginLeft: "auto" }}>通常のデモ</a>
    </header>
    <div ref={host} style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <LikeTextEditor key={document.id} initialDocument={document} onSave={() => {}} showToolbar style={{ flex: 1, minWidth: 0, minHeight: 0 }} />
    </div>
  </div>;
}
