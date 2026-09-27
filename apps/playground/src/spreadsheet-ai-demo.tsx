import { useState } from "react";
import Spreadsheet, { parseWorkbook, serializeWorkbook, type SpreadsheetHandle } from "@likex/spreadsheet";
import "../../../packages/spreadsheet/src/styles.css";
import { createDemoWorkbook } from "./demo/spreadsheet-workbook";
import { getDemoComponentTheme } from "./demo/component-theme";
import { createSpreadsheetAIAdapter } from "./ai/spreadsheet-ai-adapter";
import { AIWorkspace } from "./ai/ai-workspace";

const documentTitle = "LikeX サンプルブック";

function createDemoHost() {
    let handle: SpreadsheetHandle | null = null, revision = 0;
    return {
      attach: (value: SpreadsheetHandle | null) => { handle = value; },
      changed: () => { revision++; },
      adapter: createSpreadsheetAIAdapter(() => {
        if (!handle) throw new Error("スプレッドシートが閉じられました。");
        return handle;
      }, () => revision, { title: documentTitle }),
    };
}

export default function SpreadsheetAIDemo() {
  const [initialWorkbook] = useState(createDemoWorkbook), [theme] = useState(() => getDemoComponentTheme("light"));
  const [{ adapter, attach, changed }] = useState(createDemoHost);
  return <AIWorkspace adapter={adapter} {...theme}><Spreadsheet ref={attach} {...theme} initialWorkbook={initialWorkbook} title={documentTitle} onSave={workbook => parseWorkbook(serializeWorkbook(workbook))} onEvent={event => { if (event.type === "change" || event.type === "unsaved-changes") changed(); }} exportFileName="LikeX_AIスプレッドシート.xlsx" style={{ height: "100%", width: "100%" }} aria-label="AIで編集するスプレッドシート"/></AIWorkspace>;
}
