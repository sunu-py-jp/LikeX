import { parseWorkbook, serializeWorkbook, type SpreadsheetHandle, type SpreadsheetCommand } from "@likex/spreadsheet";
import { applySpreadsheetCommands } from "@likex/spreadsheet/model";
import { assertLiveDocumentSize, LiveDocumentError, mutationToken, type DocumentAdapter } from "./ai-document";
import type { AIJSONValue } from "../../build/ai/protocol";

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
    async live(request, signal) {
      signal.throwIfAborted();
      const handle = getHandle();
      const response = (changed?: boolean, receipts?: AIJSONValue) => {
        const snapshot = handle.getMutationSnapshot();
        return { targetId: request.targetId, document: serializeWorkbook(snapshot.workbook), token: JSON.stringify(snapshot.token),
          ...(changed === undefined ? {} : { changed, receipts }) };
      };
      if (request.action === "snapshot") {
        // Export validates unfinished UI input; the synchronous snapshot after it owns the baseline.
        await handle.exportNative({ signal }); signal.throwIfAborted();
        if (getHandle() !== handle) throw new LiveDocumentError("target_changed", "編集する資料が変わりました。");
        return response();
      }
      if (request.operation !== "apply") throw new LiveDocumentError("unsupported_operation", "全体の初期化には対応していません。対象を指定して編集してください。");
      const workbook = parseWorkbook(request.expected.document);
      const preview = applySpreadsheetCommands(workbook, request.commands as unknown as SpreadsheetCommand[]);
      if (!preview.ok) throw new LiveDocumentError(preview.code.toLowerCase(), preview.message);
      assertLiveDocumentSize(serializeWorkbook(preview.workbook));
      const result = await handle.batchAsync(request.commands as unknown as SpreadsheetCommand[], {
        expected: { workbook, token: mutationToken(request.expected.token),
          scope: request.expected.scope === "document" ? "workbook" : "targets" }, signal,
      });
      if (!result.ok) throw new LiveDocumentError(result.code === "PRECONDITION_FAILED" ? "conflict" : result.code.toLowerCase(), result.message,
        "editConflicts" in result ? result.editConflicts : undefined);
      return response(result.changed, JSON.parse(JSON.stringify(result.results)) as AIJSONValue);
    },
    async apply(document, signal, assertCurrent) {
      assertCurrent();
      // The public exporter rejects unfinished input, including input not yet in the model.
      await getHandle().exportNative({ signal });
      assertCurrent();
      await getHandle().importNative(new Blob([document], { type: "application/json" }), { discardChanges: true, signal });
    },
  };
}
