import { EditorState, Selection, TextSelection, type Transaction } from "prosemirror-state";
import { Step } from "prosemirror-transform";
import { liftListItem, wrapInList } from "prosemirror-schema-list";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { documentSchema } from "./schema";
import { normalizeDocument, normalizeDocumentMark } from "./document";
import { DOCUMENT_LIMITS, choice, identifier, number, record, text } from "./validation";
import type { DocumentCommand, DocumentCommandResult, DocumentModel, DocumentRootNode, DocumentSelection } from "./types";

const keys: Record<DocumentCommand["type"], readonly string[]> = {
  "text.insert": ["type", "from", "to", "text"], "text.delete": ["type", "from", "to"],
  "mark.set": ["type", "from", "to", "mark", "attrs", "enabled"],
  "paragraph.set": ["type", "from", "to", "nodeType", "level", "align"],
  "list.set": ["type", "from", "to", "kind"], "table.insert": ["type", "at", "rows", "columns", "header"],
  "image.insert": ["type", "at", "src", "alt", "width", "height"], "image.update": ["type", "id", "src", "alt", "width", "height"],
  "pageBreak.insert": ["type", "at"], "block.delete": ["type", "id"],
  "document.update": ["type", "title", "page"], "document.replace": ["type", "document"],
  "transaction.apply": ["type", "steps", "selection"],
};
function position(doc: ProseMirrorNode, value: unknown): number { return number(value, "Document position", 0, doc.content.size, true); }
function range(doc: ProseMirrorNode, from: unknown, to: unknown): DocumentSelection {
  const result = { from: position(doc, from), to: position(doc, to) };
  if (result.to < result.from) throw new Error("Selection end must not precede its start.");
  return result;
}
function stateAt(doc: ProseMirrorNode, selection?: DocumentSelection): EditorState {
  const initial = selection ? selection.from === selection.to ? Selection.near(doc.resolve(selection.from)) : TextSelection.between(doc.resolve(selection.from), doc.resolve(selection.to)) : Selection.atStart(doc);
  return EditorState.create({ schema: documentSchema, doc, selection: initial });
}
function findNode(doc: ProseMirrorNode, id: string): { node: ProseMirrorNode; pos: number } {
  let found: { node: ProseMirrorNode; pos: number } | undefined;
  doc.descendants((node, pos) => { if (node.attrs.id === id) found = { node, pos }; });
  if (!found) throw new Error(`Document block ${id} was not found.`);
  return found;
}
function validateStepJson(input: unknown): void {
  let count = 0, length = 0;
  const visit = (value: unknown, depth: number): void => {
    if (depth > DOCUMENT_LIMITS.depth || ++count > DOCUMENT_LIMITS.nodes * 8) throw new Error("The transaction data exceeds its structural limits.");
    if (typeof value === "string") { length += value.length; if (length > DOCUMENT_LIMITS.jsonLength) throw new Error("The transaction data exceeds its size limit."); return; }
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
    if (Array.isArray(value)) { if (value.length > DOCUMENT_LIMITS.nodes) throw new Error("The transaction array exceeds its size limit."); for (const item of value) visit(item, depth + 1); return; }
    const object = record(value, "Transaction JSON"); for (const item of Object.values(object)) visit(item, depth + 1);
  };
  visit(input, 0);
}
function applyOne(current: DocumentModel, command: DocumentCommand): DocumentCommandResult {
  const input = record(command, "Document command");
  const type = choice(input.type, Object.keys(keys) as DocumentCommand["type"][], "Document command");
  record(command, "Document command", keys[type]);
  if (command.type === "document.replace") return { document: normalizeDocument(command.document) };
  if (command.type === "document.update") {
    if (command.page !== undefined) { record(command.page, "Page update", ["width", "height", "margins"]); if (command.page.margins !== undefined) record(command.page.margins, "Margin update", ["top", "right", "bottom", "left"]); }
    return { document: normalizeDocument({ ...current, title: command.title === undefined ? current.title : command.title, page: { ...current.page, ...command.page, margins: { ...current.page.margins, ...command.page?.margins } } }) };
  }
  const doc = documentSchema.nodeFromJSON(current.content);
  let transaction: Transaction;
  let forcedSelection: DocumentSelection | undefined;
  switch (command.type) {
    case "text.insert": {
      const selection = range(doc, command.from, command.to ?? command.from);
      transaction = stateAt(doc, selection).tr.insertText(text(command.text, "Inserted text"), selection.from, selection.to);
      break;
    }
    case "text.delete": {
      const selection = range(doc, command.from, command.to);
      transaction = stateAt(doc, selection).tr.deleteRange(selection.from, selection.to);
      break;
    }
    case "mark.set": {
      const selection = range(doc, command.from, command.to);
      const mark = normalizeDocumentMark({ type: command.mark, ...(command.attrs !== undefined ? { attrs: command.attrs } : {}) });
      if (command.enabled !== undefined && typeof command.enabled !== "boolean") throw new Error("Mark enabled must be a boolean.");
      transaction = stateAt(doc, selection).tr;
      const markType = documentSchema.marks[mark.type];
      if (command.enabled === false) transaction.removeMark(selection.from, selection.to, markType);
      else if (mark.type === "text_style") {
        // Changing the color should retain each run's existing font and size.
        doc.nodesBetween(selection.from, selection.to, (node, pos) => {
          if (!node.isInline) return;
          const existing = node.marks.find(item => item.type === markType);
          const merged = { ...existing?.attrs, ...mark.attrs };
          transaction.addMark(Math.max(pos, selection.from), Math.min(pos + node.nodeSize, selection.to), markType.create(merged));
        });
      } else transaction.addMark(selection.from, selection.to, markType.create("attrs" in mark ? mark.attrs : undefined));
      forcedSelection = selection;
      break;
    }
    case "paragraph.set": {
      const selection = range(doc, command.from, command.to);
      if (command.nodeType !== undefined) choice(command.nodeType, ["paragraph", "heading"], "Paragraph type");
      if (command.level !== undefined) number(command.level, "Heading level", 1, 6, true);
      if (command.align !== undefined) choice(command.align, ["left", "center", "right", "justify"], "Alignment");
      transaction = stateAt(doc, selection).tr;
      doc.nodesBetween(selection.from, selection.to, (node, pos) => {
        if (!node.isTextblock) return;
        const target = command.nodeType ? documentSchema.nodes[command.nodeType] : node.type;
        const attrs: Record<string, unknown> = { id: node.attrs.id, align: command.align ?? node.attrs.align };
        if (target.name === "heading") attrs.level = command.level ?? node.attrs.level ?? 1;
        transaction.setNodeMarkup(pos, target, attrs);
      });
      forcedSelection = selection;
      break;
    }
    case "list.set": {
      const selection = range(doc, command.from, command.to);
      choice(command.kind, ["bullet", "ordered", "none"], "List kind");
      const state = stateAt(doc, selection);
      let applied: Transaction | undefined;
      const dispatch = (value: Transaction) => { applied = value; };
      if (command.kind === "none") {
        if (!liftListItem(documentSchema.nodes.list_item)(state, dispatch)) return { document: current, selection };
      } else {
        const target = documentSchema.nodes[command.kind === "bullet" ? "bullet_list" : "ordered_list"];
        const lists: { node: ProseMirrorNode; pos: number }[] = [];
        doc.nodesBetween(selection.from, selection.to, (node, pos) => { if (["bullet_list", "ordered_list"].includes(node.type.name)) { lists.push({ node, pos }); return false; } });
        if (lists.length) {
          applied = state.tr;
          lists.forEach(({ node, pos }) => applied!.setNodeMarkup(pos, target, { id: node.attrs.id, ...(command.kind === "ordered" ? { order: node.attrs.order ?? 1 } : {}) }));
        } else if (!wrapInList(target)(state, dispatch)) throw new Error("The current selection cannot be converted into a list.");
      }
      transaction = applied!;
      break;
    }
    case "table.insert": {
      const at = position(doc, command.at), rows = number(command.rows, "Table rows", 1, 100, true), columns = number(command.columns, "Table columns", 1, 50, true);
      if (command.header !== undefined && typeof command.header !== "boolean") throw new Error("Table header must be a boolean.");
      const content = Array.from({ length: rows }, (_, row) => documentSchema.nodes.table_row.create(null, Array.from({ length: columns }, () => documentSchema.nodes[row === 0 && command.header ? "table_header" : "table_cell"].create(null, documentSchema.nodes.paragraph.create()))));
      transaction = stateAt(doc).tr.replaceRangeWith(at, at, documentSchema.nodes.table.create(null, content));
      break;
    }
    case "image.insert": {
      const at = position(doc, command.at);
      // Normalize first to derive the natural aspect ratio when a dimension is omitted.
      const image = normalizeDocument({ ...current, content: { type: "doc", content: [{ type: "image", attrs: { src: command.src, alt: command.alt, width: command.width, height: command.height } }] } }).content.content[0];
      transaction = stateAt(doc).tr.replaceRangeWith(at, at, documentSchema.nodeFromJSON(image));
      break;
    }
    case "image.update": {
      const found = findNode(doc, identifier(command.id));
      if (found.node.type.name !== "image") throw new Error("The selected block is not an image.");
      const attrs = { ...found.node.attrs, ...(command.src !== undefined ? { src: command.src } : {}), ...(command.alt !== undefined ? { alt: command.alt } : {}), ...(command.width !== undefined ? { width: command.width } : {}), ...(command.height !== undefined ? { height: command.height } : {}) };
      if (command.width !== undefined && command.height === undefined) attrs.height = command.width * found.node.attrs.height / found.node.attrs.width;
      if (command.height !== undefined && command.width === undefined) attrs.width = command.height * found.node.attrs.width / found.node.attrs.height;
      transaction = stateAt(doc).tr.setNodeMarkup(found.pos, undefined, attrs);
      forcedSelection = { from: found.pos, to: found.pos + found.node.nodeSize };
      break;
    }
    case "pageBreak.insert": {
      const at = position(doc, command.at);
      transaction = stateAt(doc).tr.replaceRangeWith(at, at, documentSchema.nodes.page_break.create());
      break;
    }
    case "block.delete": {
      const found = findNode(doc, identifier(command.id));
      transaction = stateAt(doc).tr.deleteRange(found.pos, found.pos + found.node.nodeSize);
      break;
    }
    case "transaction.apply": {
      if (!Array.isArray(command.steps) || command.steps.length > DOCUMENT_LIMITS.commands) throw new Error("Transactions support at most 1000 steps.");
      validateStepJson(command.steps);
      transaction = stateAt(doc).tr;
      for (const json of command.steps) transaction.step(Step.fromJSON(documentSchema, json));
      if (command.selection !== undefined) {
        const selection = record(command.selection, "Transaction selection", ["from", "to"]);
        forcedSelection = range(transaction.doc, selection.from, selection.to);
      }
      break;
    }
  }
  const next = normalizeDocument({ ...current, content: transaction.doc.toJSON() as DocumentRootNode });
  return { document: next, selection: forcedSelection ?? { from: transaction.selection.from, to: transaction.selection.to } };
}
/** All commands validate against their intermediate result. An error leaves the input untouched. */
export function executeDocumentCommands(document: DocumentModel, commands: DocumentCommand | readonly DocumentCommand[]): DocumentCommandResult {
  const batch = Array.isArray(commands) ? commands : [commands];
  if (batch.length > DOCUMENT_LIMITS.commands) throw new Error("A document batch supports at most 1000 commands.");
  let result: DocumentCommandResult = { document: normalizeDocument(document) };
  for (const command of batch) result = applyOne(result.document, command);
  return result;
}
