import { useState } from "react";
import Spreadsheet, { createWorkbook, parseWorkbook, serializeWorkbook, type SpreadsheetHandle, type SpreadsheetWorkbook } from "@likex/spreadsheet";
import "../../../packages/spreadsheet/src/styles.css";
import { createDemoWorkbook } from "./demo/spreadsheet-workbook";
import { getDemoComponentTheme } from "./demo/component-theme";
import { createSpreadsheetAIAdapter } from "./ai/spreadsheet-ai-adapter";
import { AIWorkspace } from "./ai/ai-workspace";
import { DemoDocumentLibrary } from "./ai/demo-document-library";
import { DemoDocumentEditor } from "./ai/demo-document-editor";
import { useDemoDocumentRecord } from "./ai/use-demo-document-record";
import type { DemoDocumentRecord } from "./ai/demo-document-store";

type Theme = ReturnType<typeof getDemoComponentTheme>;
function createDemoHost(title: string) {
  let handle: SpreadsheetHandle | null = null, revision = 0;
  const current = () => {
    if (!handle) throw new Error("スプレッドシートが閉じられました。");
    return handle;
  };
  return {
    attach: (value: SpreadsheetHandle | null) => { handle = value; },
    changed: () => { revision++; },
    save: () => current().save(),
    adapter: createSpreadsheetAIAdapter(current, () => revision, { title }),
  };
}
async function createDocument(_title: string, source: "blank" | "sample") {
  const workbook = source === "sample" ? createDemoWorkbook() : createWorkbook();
  return { document: serializeWorkbook(workbook), itemCount: workbook.sheets.length };
}
function SpreadsheetDocument({ initial, workbook, theme, onBack }: { initial: DemoDocumentRecord; workbook: SpreadsheetWorkbook; theme: Theme; onBack(): void }) {
  const [{ adapter, attach, changed, save }] = useState(() => createDemoHost(initial.title));
  const [dirty, setDirty] = useState(false), [aiBusy, setAIBusy] = useState(false);
  const { record, persist, isSaving } = useDemoDocumentRecord(initial);
  return <DemoDocumentEditor title={record.title} kind="spreadsheet" {...theme} dirty={dirty} busy={aiBusy || isSaving} onSave={save} onBack={onBack}>
    <AIWorkspace adapter={adapter} {...theme} onBusyChange={setAIBusy}>
      <Spreadsheet ref={attach} {...theme} initialWorkbook={workbook} title={record.title}
        onSave={async current => {
          const document = serializeWorkbook(current);
          await persist(document, record.title, current.sheets.length);
          return parseWorkbook(document);
        }} onUnsavedChangesChange={setDirty}
        onEvent={event => { if (event.type === "change" || event.type === "unsaved-changes") changed(); }}
        exportFileName={record.title} style={{ height: "100%", width: "100%" }} aria-label="AIで編集するスプレッドシート"/>
    </AIWorkspace>
  </DemoDocumentEditor>;
}

export default function SpreadsheetAIDemo() {
  const [theme] = useState(() => getDemoComponentTheme("light"));
  const [opened, setOpened] = useState<{ record: DemoDocumentRecord; workbook: SpreadsheetWorkbook } | null>(null);
  if (opened) return <SpreadsheetDocument key={opened.record.id} initial={opened.record} workbook={opened.workbook} theme={theme} onBack={() => setOpened(null)}/>;
  return <DemoDocumentLibrary kind="spreadsheet" label="スプレッドシート" {...theme} createDocument={createDocument}
    onOpen={record => { const workbook = parseWorkbook(record.document); setOpened({ record, workbook }); }}/>;
}
