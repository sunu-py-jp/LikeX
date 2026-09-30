import { parseWorkbook, serializeWorkbook, type SpreadsheetHandle } from "@likex/spreadsheet";
import type { DocumentAdapter } from "./ai-document";

export function createSpreadsheetAIAdapter(getHandle: () => SpreadsheetHandle, getRevision: () => number, options: { title?: string } = {}): DocumentAdapter {
  return {
    module: "spreadsheet", label: "Spreadsheet",
    suggestions: ["今のシートに商品・数量・単価・合計の売上表を作って", "選択した範囲に罫線をつけて見出しを青色にして", "新しいシートに来週のタスク管理表を作って"],
    async snapshot(signal) {
      const document = await (await getHandle().exportNative({ signal })).text();
      signal.throwIfAborted();
      return { document, documentTitle: options.title ?? "Spreadsheet", revision: getRevision(), selection: getHandle().getSelection() };
    },
    readCurrent: () => ({ document: serializeWorkbook(getHandle().getWorkbook()), revision: getRevision() }),
    normalize: document => serializeWorkbook(parseWorkbook(document)),
    async apply(document, signal, assertCurrent) {
      assertCurrent();
      // The public exporter rejects unfinished input, including input not yet in the model.
      await getHandle().exportNative({ signal });
      assertCurrent();
      await getHandle().importNative(new Blob([document], { type: "application/json" }), { discardChanges: true, signal });
    },
  };
}
