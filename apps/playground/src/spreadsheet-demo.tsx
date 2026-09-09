import { useCallback, useRef, useState } from "react";
import Spreadsheet, { parseWorkbook, serializeWorkbook, type SpreadsheetWorkbook } from "@likex/spreadsheet";
import "../../../packages/spreadsheet/src/styles.css";
import { createDemoWorkbook } from "./demo/spreadsheet-workbook";

export default function SpreadsheetDemo() {
  const [initialWorkbook] = useState(createDemoWorkbook);
  const savedJson = useRef<string | null>(null);
  const save = useCallback((workbook: SpreadsheetWorkbook) => {
    savedJson.current = serializeWorkbook(workbook);
    return parseWorkbook(savedJson.current);
  }, []);
  return <Spreadsheet
    title="下期 売上計画"
    initialWorkbook={initialWorkbook}
    onSave={save}
    style={{ height: "100dvh", width: "100%" }}
    aria-label="売上計画スプレッドシート"
  />;
}
