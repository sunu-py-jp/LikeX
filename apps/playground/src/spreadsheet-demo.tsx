import { useCallback, useRef, useState } from "react";
import Spreadsheet, { parseWorkbook, serializeWorkbook, type SpreadsheetWorkbook, type SpreadsheetContextMenuProvider } from "@likex/spreadsheet";
import "../../../packages/spreadsheet/src/styles.css";
import { createDemoWorkbook } from "./demo/spreadsheet-workbook";
import { createSelectionSum } from "./demo/selection-sum";
import { getDemoContextMenuMode } from "./demo/context-menu-mode";

const contextMenuItems: SpreadsheetContextMenuProvider = context => {
  if (context.readOnly || !context.features.formulas) return [];
  return [{
    id: "demo-selection-sum",
    label: "選択範囲のSUMを挿入",
    onSelect: captured => {
      const formula = createSelectionSum(captured);
      return {
        change: [{ type: "cells.set", sheetId: captured.target.sheetId, values: { [captured.target.address]: formula } }],
        description: `${captured.target.address} に ${formula} を設定します。`,
      };
    },
  }];
};

export default function SpreadsheetDemo() {
  const [initialWorkbook] = useState(createDemoWorkbook);
  const [contextMenuMode] = useState(getDemoContextMenuMode);
  const savedJson = useRef<string | null>(null);
  const save = useCallback((workbook: SpreadsheetWorkbook) => {
    savedJson.current = serializeWorkbook(workbook);
    return parseWorkbook(savedJson.current);
  }, []);
  return <Spreadsheet
    title="下期 売上計画"
    initialWorkbook={initialWorkbook}
    onSave={save}
    getContextMenuItems={contextMenuItems}
    contextMenuExecutionMode={contextMenuMode}
    style={{ height: "100dvh", width: "100%" }}
    aria-label="売上計画スプレッドシート"
  />;
}
