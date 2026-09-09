import { useCallback, useRef, useState } from "react";
import Spreadsheet, { type SpreadsheetWorkbook } from "@likex/spreadsheet";
import "../../../packages/spreadsheet/src/styles.css";
import { createDemoWorkbook } from "./demo/spreadsheet-workbook";

export default function SpreadsheetDemo() {
  const [initialWorkbook] = useState(createDemoWorkbook);
  const savedWorkbook = useRef(initialWorkbook);
  const save = useCallback((workbook: SpreadsheetWorkbook) => {
    savedWorkbook.current = workbook;
    return workbook;
  }, []);
  return <Spreadsheet
    title="下期 売上計画"
    initialWorkbook={initialWorkbook}
    onSave={save}
    style={{ height: "100dvh", width: "100%" }}
    aria-label="売上計画スプレッドシート"
  />;
}
