import { useState } from "react";
import Spreadsheet, { createWorkbook, parseWorkbook, serializeWorkbook, type SpreadsheetHandle, type SpreadsheetWorkbook } from "@likex/spreadsheet";
import "../../../packages/spreadsheet/src/styles.css";
import { createDemoWorkbook } from "./demo/spreadsheet-workbook";
import { createDesignTemplateWorkbook, isDesignTemplateWorkbook, DESIGN_TEMPLATE_ID, DESIGN_TEMPLATE_TITLE,
  DESIGN_TEMPLATE_DESCRIPTION, DESIGN_TEMPLATE_PROMPT } from "./demo/spreadsheet-design-template";
import { getDemoComponentTheme } from "./demo/component-theme";
import { createSpreadsheetAIAdapter } from "./ai/spreadsheet-ai-adapter";
import { AIWorkspace } from "./ai/ai-workspace";
import { DemoDocumentLibrary } from "./ai/demo-document-library";
import { DemoDocumentEditor } from "./ai/demo-document-editor";
import { useDemoDocumentRecord } from "./ai/use-demo-document-record";
import type { DemoDocumentRecord } from "./ai/demo-document-store";

type Theme = ReturnType<typeof getDemoComponentTheme>;
function createDemoHost(title: string, workbook: SpreadsheetWorkbook) {
  let handle: SpreadsheetHandle | null = null, revision = 0;
  const current = () => {
    if (!handle) throw new Error("スプレッドシートが閉じられました。");
    return handle;
  };
  const adapter = createSpreadsheetAIAdapter(current, () => revision, { title });
  if (isDesignTemplateWorkbook(workbook)) {
    adapter.initialChatOpen = true;
    adapter.introduction = { title: "テンプレートから基本設計書を作る", description: "書式と記入欄を用意しました。「要件資料」のサンプルを確認・編集してから、AIに完成を依頼できます。内容は架空の購買業務です。" };
    adapter.suggestions = [
      { label: "要件資料から設計書を完成させる", prompt: DESIGN_TEMPLATE_PROMPT },
      { label: "記入内容の不足・矛盾を確認する", prompt: "この基本設計書の要件資料を参照し、各シートの記入内容、項目IDとチェックIDの対応、計算式、処理フローの整合を確認してください。必要なデータだけ取得し、要件で決まっていないことは推測せず未確定として報告してください。今回は編集せず、不足や矛盾をチャットで説明してください。" },
    ];
  }
  return {
    attach: (value: SpreadsheetHandle | null) => { handle = value; },
    changed: () => { revision++; },
    save: () => current().save(),
    adapter,
  };
}
async function createDocument(_title: string, source: string) {
  if (!["blank", "sample", DESIGN_TEMPLATE_ID].includes(source)) throw new Error("テンプレートが見つかりません。");
  const workbook = source === DESIGN_TEMPLATE_ID ? createDesignTemplateWorkbook() : source === "sample" ? createDemoWorkbook() : createWorkbook();
  return { document: serializeWorkbook(workbook), itemCount: workbook.sheets.length };
}
function SpreadsheetDocument({ initial, workbook, theme, onBack }: { initial: DemoDocumentRecord; workbook: SpreadsheetWorkbook; theme: Theme; onBack(): void }) {
  const [{ adapter, attach, changed, save }] = useState(() => createDemoHost(initial.title, workbook));
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
    templates={[{ id: DESIGN_TEMPLATE_ID, title: "基本設計書", description: DESIGN_TEMPLATE_DESCRIPTION, defaultTitle: DESIGN_TEMPLATE_TITLE }]}
    onOpen={record => { const workbook = parseWorkbook(record.document); setOpened({ record, workbook }); }}/>;
}
