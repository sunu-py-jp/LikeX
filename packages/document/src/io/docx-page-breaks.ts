import { attr, child, localName, type Node, type XmlNode } from "./docx-reader";

/** Section properties live at a section's END, but type describes its START. */
export function readDocxSections(body: XmlNode) {
  const endings: { paragraph: XmlNode; properties: XmlNode }[] = [];
  const visit = (source: XmlNode) => {
    for (const node of source.children) {
      const name = localName(node.name);
      if (name === "p") {
        const properties = child(child(node, "pPr"), "sectPr");
        if (properties) endings.push({ paragraph: node, properties });
      } else if (name === "sdt") {
        const content = child(node, "sdtContent"); if (content) visit(content);
      } else if (name === "customXml" || name === "ins") visit(node);
      // Do not read tables, drawings, deleted content or sectPrChange history.
    }
  };
  visit(body);
  const final = child(body, "sectPr"), after = new WeakMap<XmlNode, string>();
  endings.forEach((ending, index) => after.set(ending.paragraph,
    attr(child(endings[index + 1]?.properties ?? final, "type"), "val") ?? "nextPage"));
  return { after, sections: [...endings.map(ending => ending.properties), ...(final ? [final] : [])] };
}

/** Import-only provenance avoids counting Word's duplicate boundary markers twice. */
export function createDocxPageBreakReader(warn: (message: string) => void) {
  const implied = new WeakSet<Node>();
  const pageBreak = (implicit = false): Node => {
    const node = { type: "page_break" }; if (implicit) implied.add(node); return node;
  };
  const sectionBreak = (type: string | undefined): Node | undefined => {
    if (type === undefined || type === "continuous") return;
    if (type === "nextColumn") { warn("次の段から始まるセクション区切りは省略しました"); return; }
    if (type === "oddPage" || type === "evenPage") warn("奇数・偶数ページから始まるセクション区切りは、空白ページを補わず1つの改ページに変換しました");
    else if (type !== "nextPage") { warn("未対応のセクション開始方法は次ページ開始として読み込みました"); }
    return pageBreak(true);
  };
  const renderedBreak = (): Node => {
    warn("保存時の自動改ページ位置を読み込みました。編集後の改ページ位置は再計算しません");
    return { type: "rendered_page_break" };
  };
  const finish = (content: Node[]): Node[] => {
    let atBoundary = true, lastRendered: Node | undefined;
    const removed = new WeakSet<Node>();
    const walk = (nodes: Node[]) => {
      for (const node of nodes) {
        if (node.type === "page_break") {
          // Keep consecutive manual breaks (intentional blank pages). Prefer a
          // real break over a saved layout marker at the same text position.
          if (lastRendered) removed.add(lastRendered);
          else if (implied.has(node) && atBoundary) removed.add(node);
          atBoundary = true; lastRendered = undefined;
        } else if (node.type === "rendered_page_break") {
          if (atBoundary) removed.add(node);
          else { atBoundary = true; lastRendered = node; }
        } else if (node.content?.length) {
          walk(node.content);
          if ((node.type === "paragraph" || node.type === "heading") && node.content.every(child => removed.has(child))) {
            atBoundary = false; lastRendered = undefined;
          }
        }
        else if (node.type !== "table_row") {
          // Empty paragraphs still occupy space; wrapper/row boundaries don't.
          atBoundary = false; lastRendered = undefined;
        }
      }
    };
    walk(content);
    const prune = (nodes: Node[]): Node[] => nodes.filter(node => !removed.has(node)).map(node => {
      if (node.content) node.content = prune(node.content);
      return node;
    });
    return prune(content);
  };
  return { pageBreak, sectionBreak, renderedBreak, finish };
}
