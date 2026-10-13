import { cellAddress, parseCellAddress } from "../model/address";
import { normalizeComment } from "../model/annotations";
import { getMergedRange, rangesIntersect } from "../model/merges";
import { normalizeTables } from "../model/tables/normalize";
import type { SpreadsheetTable } from "../model/tables/types";
import { SPREADSHEET_LIMITS, type SpreadsheetComment, type SpreadsheetSheet } from "../model/types";
import { adjusted, growSheet, omitted, readRange } from "./worksheet-shared";
import type { XlsxRelationship } from "./relationships";
import { importFailureMessage, rethrowImportFailure } from "./recovery";
import type { ImportContext } from "./types";
import { attribute, child, children, localName, parseXml, spreadsheetText, textContent, type XmlNode } from "./xml";

function commentText(node: XmlNode | undefined): string {
  if (!node) return "";
  if (localName(node.name) === "t") return spreadsheetText(textContent(node));
  return node.children.map(commentText).join("");
}
/** Optional XML can be omitted, but cancellation and ZIP-integrity failures are fatal. */
function recoveryReason(error: unknown, context: ImportContext): string {
  rethrowImportFailure(error, context);
  return importFailureMessage(error);
}
async function optionalPart(target: string, expected: string, sheet: SpreadsheetSheet, context: ImportContext): Promise<XmlNode | undefined> {
  const label = expected === "comments" ? "コメント" : "テーブル";
  if (!context.archive.has(target)) { omitted(context, sheet, `${label}「${target.slice(0, 160)}」を省略しました（参照先がありません）`); return; }
  try {
    const root = parseXml(await context.archive.read(target));
    context.signal?.throwIfAborted();
    if (localName(root.name) !== expected) throw new Error(`Excelの${label}データが不正です`);
    return root;
  } catch (error) {
    omitted(context, sheet, `${label}「${target.slice(0, 160)}」を省略しました（${recoveryReason(error, context)}）`);
  }
}
export async function readWorksheetComments(initial: SpreadsheetSheet, relationships: ReadonlyMap<string, XlsxRelationship>, context: ImportContext): Promise<SpreadsheetSheet> {
  let sheet = initial, visited = 0;
  const comments: Record<string, SpreadsheetComment> = Object.create(null);
  for (const relation of relationships.values()) {
    if (/\/(?:threadedComment|threadedComments)$/.test(relation.type)) { omitted(context, sheet, "スレッド形式のコメントを省略しました"); continue; }
    if (!relation.type.endsWith("/comments")) continue;
    if (relation.external) { omitted(context, sheet, "外部参照のコメントを省略しました"); continue; }
    context.signal?.throwIfAborted();
    const root = await optionalPart(relation.target, "comments", sheet, context);
    if (!root) continue;
    const authors = children(child(root, "authors"), "author").map(item => spreadsheetText(textContent(item)));
    const items = children(child(root, "commentList"), "comment");
    for (const [index, item] of items.entries()) {
      context.signal?.throwIfAborted();
      visited++;
      const reference = (item.attributes.ref ?? "範囲なし").slice(0, 160);
      const skip = (reason: string) => omitted(context, sheet, `コメント「${reference}」を省略しました（${reason}）`);
      if ((context.commentCount ?? 0) >= SPREADSHEET_LIMITS.comments) {
        omitted(context, sheet, `コメント「${reference}」以降を省略しました（ブック全体の上限 ${SPREADSHEET_LIMITS.comments} 件）`, items.length - index); break;
      }
      const position = parseCellAddress(item.attributes.ref);
      if (!position) { skip("シート上限外または不正な位置"); continue; }
      try {
        const text = commentText(child(item, "text")), author = authors[Number(item.attributes.authorId ?? 0)];
        if (text.length > SPREADSHEET_LIMITS.commentLength || (author?.length ?? 0) > 200) { skip("文字数上限を超えています"); continue; }
        const merge = getMergedRange(sheet, position);
        const address = cellAddress(merge?.top ?? position.row, merge?.left ?? position.column);
        if (comments[address]) { skip("同じセルのコメントが重複しています"); continue; }
        const comment = normalizeComment({ id: `${sheet.id}-comment-${visited}`, text, ...(author ? { author } : {}) });
        const candidate = growSheet(sheet, position.row, position.column);
        if (merge && (position.row !== merge.top || position.column !== merge.left)) adjusted(context, sheet, `結合セルのコメントを左上のセルへ移しました（元の位置: ${reference}）`);
        comments[address] = comment; sheet = candidate;
        context.commentCount = (context.commentCount ?? 0) + 1;
      } catch (error) { skip(recoveryReason(error, context)); }
    }
  }
  return Object.keys(comments).length ? { ...sheet, comments } : sheet;
}
export async function readWorksheetTables(node: XmlNode, initial: SpreadsheetSheet, relationships: ReadonlyMap<string, XlsxRelationship>, context: ImportContext): Promise<SpreadsheetSheet> {
  let sheet = initial, visited = 0;
  const tables: SpreadsheetTable[] = [];
  const items = children(child(node, "tableParts"), "tablePart");
  for (const [index, item] of items.entries()) {
    context.signal?.throwIfAborted(); visited++;
    const reference = (attribute(item, "id") ?? "参照なし").slice(0, 160);
    if ((context.tableCount ?? 0) >= SPREADSHEET_LIMITS.tables) {
      omitted(context, sheet, `テーブル「${reference}」以降を省略しました（ブック全体の上限 ${SPREADSHEET_LIMITS.tables} 件、セルの値は保持）`, items.length - index); break;
    }
    const relation = relationships.get(attribute(item, "id") ?? "");
    if (!relation || relation.external || !relation.type.endsWith("/table")) { omitted(context, sheet, `テーブル「${reference}」を省略しました（外部参照または不正なテーブル定義）`); continue; }
    const root = await optionalPart(relation.target, "table", sheet, context);
    if (!root) continue;
    const rangeReference = (root.attributes.ref ?? "範囲なし").slice(0, 160);
    const skip = (reason: string) => omitted(context, sheet, `テーブル「${rangeReference}」を省略しました（${reason}、セルの値は保持）`);
    const range = readRange(root.attributes.ref), columns = children(child(root, "tableColumns"), "tableColumn");
    if (!range || root.attributes.headerRowCount === "0") { skip("見出しがない、または対応範囲外のテーブル定義"); continue; }
    let bottom = range.bottom;
    if (Number(root.attributes.totalsRowCount ?? 0) > 0) bottom--;
    if (bottom < range.top) { skip("未対応のテーブル定義"); continue; }
    try {
      const candidate = growSheet(sheet, range.bottom, range.right), id = `${sheet.id}-table-${visited}`;
      const table = { id, name: spreadsheetText(root.attributes.displayName ?? root.attributes.name ?? ""), range: { ...range, bottom },
        columns: columns.map((column, index) => ({ id: `${id}-column-${index + 1}`, name: spreadsheetText(column.attributes.name ?? "") })) };
      const normalized = normalizeTables([table], candidate)![0];
      if (tables.some(other => rangesIntersect(other.range, normalized.range))) { skip("テーブルの範囲が重複しています"); continue; }
      const names = context.tableNames ??= new Set<string>(), nameKey = normalized.name.toLocaleLowerCase("en-US");
      if (names.has(nameKey)) { omitted(context, sheet, `名前が重複するテーブル「${normalized.name}」の定義を省略しました（セルの値は保持）`); continue; }
      names.add(nameKey);
      tables.push(normalized); sheet = candidate;
      context.tableCount = (context.tableCount ?? 0) + 1;
      if (bottom < range.bottom) adjusted(context, sheet, `テーブル「${rangeReference}」の集計行を通常のセルとして保持しました`);
    } catch (error) { skip(recoveryReason(error, context)); continue; }
    if (child(root, "tableStyleInfo")) omitted(context, sheet, "テーブルの自動スタイルを省略しました（明示したセル書式は保持）");
    if (child(child(root, "autoFilter"), "filterColumn") || child(root, "sortState")) omitted(context, sheet, "テーブルのフィルター・並べ替え状態を省略しました");
  }
  return tables.length ? { ...sheet, tables } : sheet;
}
