import { cellAddress, parseCellAddress } from "../model/address";
import { normalizeComment } from "../model/annotations";
import { normalizeTables } from "../model/tables/normalize";
import type { SpreadsheetTable } from "../model/tables/types";
import { SPREADSHEET_LIMITS, type SpreadsheetComment, type SpreadsheetSheet } from "../model/types";
import { adjusted, growSheet, omitted, readRange } from "./worksheet-shared";
import type { XlsxRelationship } from "./relationships";
import type { ImportContext } from "./types";
import { attribute, child, children, localName, parseXml, spreadsheetText, textContent, type XmlNode } from "./xml";

function commentText(node: XmlNode | undefined): string {
  if (!node) return "";
  if (localName(node.name) === "t") return spreadsheetText(textContent(node));
  return node.children.map(commentText).join("");
}
export async function readWorksheetComments(initial: SpreadsheetSheet, relationships: ReadonlyMap<string, XlsxRelationship>, context: ImportContext): Promise<SpreadsheetSheet> {
  let sheet = initial, visited = 0;
  const comments: Record<string, SpreadsheetComment> = Object.create(null);
  for (const relation of relationships.values()) {
    if (/\/(?:threadedComment|threadedComments)$/.test(relation.type)) { omitted(context, sheet, "スレッド形式のコメントを省略しました"); continue; }
    if (!relation.type.endsWith("/comments")) continue;
    if (relation.external) { omitted(context, sheet, "外部参照のコメントを省略しました"); continue; }
    context.signal?.throwIfAborted();
    const root = parseXml(await context.archive.read(relation.target));
    if (localName(root.name) !== "comments") throw new Error("Excelのコメントデータが不正です");
    const authors = children(child(root, "authors"), "author").map(item => spreadsheetText(textContent(item)));
    for (const item of children(child(root, "commentList"), "comment")) {
      if (++visited > SPREADSHEET_LIMITS.comments) throw new Error("Excelのコメント数が上限を超えています");
      const position = parseCellAddress(item.attributes.ref);
      if (!position) { omitted(context, sheet, "シート上限外のコメントを省略しました"); continue; }
      const text = commentText(child(item, "text")), author = authors[Number(item.attributes.authorId ?? 0)];
      if (text.length > SPREADSHEET_LIMITS.commentLength || (author?.length ?? 0) > 200) { omitted(context, sheet, "文字数上限を超えたコメントを省略しました"); continue; }
      const merge = sheet.merges?.find(range => position.row >= range.top && position.row <= range.bottom && position.column >= range.left && position.column <= range.right);
      const address = cellAddress(merge?.top ?? position.row, merge?.left ?? position.column);
      if (comments[address]) { omitted(context, sheet, "同じセルの重複コメントを省略しました"); continue; }
      if (merge && (position.row !== merge.top || position.column !== merge.left)) adjusted(context, sheet, "結合セルのコメントを左上のセルへ移しました");
      sheet = growSheet(sheet, position.row, position.column);
      comments[address] = normalizeComment({ id: `${sheet.id}-comment-${visited}`, text, ...(author ? { author } : {}) });
    }
  }
  return Object.keys(comments).length ? { ...sheet, comments } : sheet;
}
export async function readWorksheetTables(node: XmlNode, initial: SpreadsheetSheet, relationships: ReadonlyMap<string, XlsxRelationship>, context: ImportContext): Promise<SpreadsheetSheet> {
  let sheet = initial, visited = 0;
  const tables: SpreadsheetTable[] = [];
  for (const item of children(child(node, "tableParts"), "tablePart")) {
    context.signal?.throwIfAborted();
    if (++visited > SPREADSHEET_LIMITS.tables) throw new Error("Excelのテーブル数が上限を超えています");
    const relation = relationships.get(attribute(item, "id") ?? "");
    if (!relation || relation.external || !relation.type.endsWith("/table")) { omitted(context, sheet, "外部参照または不正なテーブル定義を省略しました"); continue; }
    const root = parseXml(await context.archive.read(relation.target));
    if (localName(root.name) !== "table") throw new Error("Excelのテーブル定義が不正です");
    const range = readRange(root.attributes.ref), columns = children(child(root, "tableColumns"), "tableColumn");
    if (!range || root.attributes.headerRowCount === "0") { omitted(context, sheet, "見出しのないテーブル・対応範囲外のテーブル定義を省略しました"); continue; }
    let bottom = range.bottom;
    if (Number(root.attributes.totalsRowCount ?? 0) > 0) { bottom--; adjusted(context, sheet, "テーブルの集計行を通常のセルとして保持しました"); }
    if (bottom < range.top) { omitted(context, sheet, "未対応のテーブル定義を省略しました"); continue; }
    const candidate = growSheet(sheet, range.bottom, range.right), id = `${sheet.id}-table-${visited}`;
    const table = { id, name: spreadsheetText(root.attributes.displayName ?? root.attributes.name ?? ""), range: { ...range, bottom },
      columns: columns.map((column, index) => ({ id: `${id}-column-${index + 1}`, name: spreadsheetText(column.attributes.name ?? "") })) };
    try { normalizeTables([...tables, table], candidate); } catch { omitted(context, sheet, "見出し・範囲が対応しないテーブル定義を省略しました（セルの値は保持）"); continue; }
    tables.push(table); sheet = candidate;
    if (child(root, "tableStyleInfo")) omitted(context, sheet, "テーブルの自動スタイルを省略しました（明示したセル書式は保持）");
    if (child(child(root, "autoFilter"), "filterColumn") || child(root, "sortState")) omitted(context, sheet, "テーブルのフィルター・並べ替え状態を省略しました");
  }
  return tables.length ? { ...sheet, tables } : sheet;
}
