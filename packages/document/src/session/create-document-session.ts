import { createDocument, documentSchema, executeDocumentCommands, normalizeDocument, serializeDocument } from "../model/index";
import type { DocumentCommand, DocumentCommandResult, DocumentModel } from "../model/types";

export type DocumentSessionSelection = Readonly<{ from: number; to: number }>;
type Entry = { document: DocumentModel; selection: DocumentSessionSelection };
export type DocumentSessionSnapshot = Readonly<Entry & { dirty: boolean; canUndo: boolean; canRedo: boolean }>;

/** Headless local history. Host permission and persistence remain outside this session. */
export function createDocumentSession(initialDocument?: DocumentModel) {
  let document = initialDocument ? normalizeDocument(initialDocument) : createDocument();
  let baseline = document, baselineJSON = serializeDocument(document);
  let selection: DocumentSessionSelection = Object.freeze({ from: 1, to: 1 });
  let baselineSelection = selection;
  const past: Entry[] = [], future: Entry[] = [], listeners = new Set<() => void>();
  let snapshot: DocumentSessionSnapshot = Object.freeze({ document, selection, dirty: false, canUndo: false, canRedo: false });
  let lastGroup: string | undefined, lastTime = 0;
  function publish() {
    selection = Object.freeze({ ...selection });
    snapshot = Object.freeze({ document, selection, dirty: serializeDocument(document) !== baselineJSON, canUndo: past.length > 0, canRedo: future.length > 0 });
    for (const listener of listeners) { try { listener(); } catch { /* A subscriber cannot undo a committed change. */ } }
  }
  function validSelection(value: DocumentSessionSelection): DocumentSessionSelection {
    const max = documentSchema.nodeFromJSON(document.content).content.size;
    if (!Number.isInteger(value.from) || !Number.isInteger(value.to) || value.from < 0 || value.to < value.from || value.to > max) throw new Error("文書内の選択範囲を指定してください。");
    return Object.freeze({ from: value.from, to: value.to });
  }
  function select(value: DocumentSessionSelection) {
    const next = validSelection(value);
    if (next.from === selection.from && next.to === selection.to) return;
    selection = next; lastGroup = undefined; publish();
  }
  function execute(commands: DocumentCommand | readonly DocumentCommand[], options: { historyGroup?: string } = {}): DocumentCommandResult {
    const result = executeDocumentCommands(document, commands);
    if (serializeDocument(result.document) === serializeDocument(document)) return result;
    const now = Date.now();
    if (!options.historyGroup || options.historyGroup !== lastGroup || now - lastTime > 700) {
      past.push({ document, selection }); if (past.length > 100) past.shift();
    }
    lastGroup = options.historyGroup; lastTime = now; future.length = 0;
    document = result.document;
    const max = documentSchema.nodeFromJSON(document.content).content.size;
    selection = result.selection ?? { from: Math.min(selection.from, max), to: Math.min(selection.to, max) };
    publish(); return result;
  }
  function history(direction: "undo" | "redo") {
    const source = direction === "undo" ? past : future, target = direction === "undo" ? future : past;
    const entry = source.pop(); if (!entry) return false;
    target.push({ document, selection }); document = entry.document; selection = entry.selection;
    lastGroup = undefined; publish(); return true;
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    execute, select,
    undo: () => history("undo"), redo: () => history("redo"),
    markSaved(saved?: DocumentModel) {
      if (saved) {
        const next = normalizeDocument(saved);
        if (serializeDocument(next) !== serializeDocument(document)) {
          past.push({ document, selection }); if (past.length > 100) past.shift(); future.length = 0; document = next;
          const max = documentSchema.nodeFromJSON(document.content).content.size;
          selection = { from: Math.min(selection.from, max), to: Math.min(selection.to, max) };
        }
      }
      baseline = document; baselineSelection = selection; baselineJSON = serializeDocument(baseline); lastGroup = undefined; publish();
    },
    discard() { document = baseline; selection = baselineSelection; past.length = 0; future.length = 0; lastGroup = undefined; publish(); },
  });
}
export type DocumentSession = ReturnType<typeof createDocumentSession>;
