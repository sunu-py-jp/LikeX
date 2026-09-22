import type { DocumentFeatures } from "../props";
import type { DocumentCommand, DocumentModel } from "../model/types";
import { documentSchema, executeDocumentCommands } from "../model/index";
import { Step } from "prosemirror-transform";

export const defaultDocumentFeatures = Object.freeze({ text: true, formatting: true, lists: true, tables: true, images: true, pageLayout: true, import: true, export: true, history: true });
export function resolveDocumentFeatures(features?: DocumentFeatures) {
  const result: Record<keyof typeof defaultDocumentFeatures, boolean> = { ...defaultDocumentFeatures };
  for (const key of Object.keys(result) as (keyof typeof result)[]) if (features?.[key] === false) result[key] = false;
  return result;
}
export type ResolvedDocumentFeatures = ReturnType<typeof resolveDocumentFeatures>;

/** A delete+insert move must not bypass a disabled resource feature merely because its final attributes are unchanged. */
function assertRawSteps(before: DocumentModel, commands: readonly DocumentCommand[], features: ResolvedDocumentFeatures) {
  if (!commands.some(command => command.type === "transaction.apply")) return;
  let document = before;
  const protectedTypes = new Set<string>([
    ...(!features.images ? ["image"] : []), ...(!features.tables ? ["table", "table_row", "table_cell", "table_header"] : []),
    ...(!features.lists ? ["bullet_list", "ordered_list", "list_item"] : []), ...(!features.pageLayout ? ["page_break"] : []),
  ]);
  if (protectedTypes.size === 0 && features.formatting) return;
  for (const command of commands) {
    if (command.type === "transaction.apply") {
      let doc = documentSchema.nodeFromJSON(document.content);
      for (const json of command.steps) {
        if (!features.formatting && ["addMark", "removeMark", "addNodeMark", "removeNodeMark"].includes(String(json.stepType))) throw new Error("書式の変更は無効です。");
        const step = Step.fromJSON(documentSchema, json);
        const intervals: [number, number][] = [];
        if (json.stepType === "replaceAround") intervals.push([Number(json.from), Number(json.gapFrom)], [Number(json.gapTo), Number(json.to)]);
        else step.getMap().forEach((from, to) => intervals.push([from, to]));
        for (const [from, to] of intervals) {
          if (from === to) continue;
          doc.nodesBetween(from, to, (node, pos) => {
            if (!protectedTypes.has(node.type.name)) return;
            // Editing text inside a cell/list item does not remove that resource's boundary tokens.
            if ((pos >= from && pos < to) || (pos + node.nodeSize - 1 >= from && pos + node.nodeSize - 1 < to)) throw new Error("この編集機能は無効です。");
          });
        }
        const next = step.apply(doc);
        if (next.failed || !next.doc) throw new Error(next.failed ?? "文書を変更できません。");
        doc = next.doc;
      }
    }
    document = executeDocumentCommands(document, command).document;
  }
}
export function assertDocumentFeatures(before: DocumentModel, after: DocumentModel, commands: readonly DocumentCommand[], features: ResolvedDocumentFeatures) {
  const required: Partial<Record<DocumentCommand["type"], keyof ResolvedDocumentFeatures>> = { "text.insert": "text", "text.delete": "text", "mark.set": "formatting", "paragraph.set": "formatting", "list.set": "lists", "table.insert": "tables", "image.insert": "images", "image.update": "images", "pageBreak.insert": "pageLayout" };
  for (const command of commands) {
    const feature = required[command.type];
    if (feature && !features[feature]) throw new Error("この編集機能は無効です。");
  }
  if (commands.some(command => command.type === "document.replace")) {
    if (!features.import) throw new Error("文書の読み込みは無効です。");
    // An explicit whole-document import includes its formatting and resources; other commands in a batch retain their guards.
    if (commands.length > 1) {
      let current = before;
      for (const command of commands) {
        const next = executeDocumentCommands(current, command).document;
        if (command.type !== "document.replace") assertDocumentFeatures(current, next, [command], features);
        current = next;
      }
    }
    return;
  }
  if (features.text && features.formatting && features.lists && features.tables && features.images && features.pageLayout) return;
  assertRawSteps(before, commands, features);
  const a = documentSchema.nodeFromJSON(before.content), b = documentSchema.nodeFromJSON(after.content);
  if (!features.text && a.textBetween(0, a.content.size, "\n") !== b.textBetween(0, b.content.size, "\n")) throw new Error("文字の編集は無効です。");
  if (!features.pageLayout && JSON.stringify(before.page) !== JSON.stringify(after.page)) throw new Error("ページ設定の変更は無効です。");
  function projection(node: typeof a, kinds: string[], marks = false): string {
    const result: unknown[] = [];
    node.descendants(child => {
      if (kinds.includes(child.type.name)) {
        const attrs = { ...child.attrs }; delete attrs.id;
        // Plain paragraphs may split/join during normal text editing even when formatting is disabled.
        if (!(child.type.name === "paragraph" && attrs.align === "left")) result.push({ type: child.type.name, attrs });
      }
      if (marks && child.isText && child.marks.length) result.push(child.marks.map(mark => mark.toJSON()));
    });
    return JSON.stringify(result);
  }
  const groups: [keyof ResolvedDocumentFeatures, string[]][] = [["images", ["image"]], ["tables", ["table", "table_row", "table_cell", "table_header"]], ["lists", ["bullet_list", "ordered_list", "list_item"]], ["pageLayout", ["page_break"]]];
  for (const [feature, kinds] of groups) if (!features[feature] && projection(a, kinds) !== projection(b, kinds)) throw new Error("この編集機能は無効です。");
  if (!features.formatting && projection(a, ["heading", "paragraph"], true) !== projection(b, ["heading", "paragraph"], true)) throw new Error("書式の変更は無効です。");
}
